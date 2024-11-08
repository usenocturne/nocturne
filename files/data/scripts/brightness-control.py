"""
Buttons monitoring, restructured to adjust brightness by shadow (68p), originally created by bishopdynamics for Home Assistant
"""
# pylint: disable=global-statement,line-too-long,broad-exception-caught,logging-fstring-interpolation

# https://stackoverflow.com/questions/5060710/format-of-dev-input-event

import time
import struct
import logging
import threading

from threading import Thread
from threading import Event as ThreadEvent

# user-configurable settings are all in button_settings.py
from brightness_settings import LEVEL_INCREMENT 
import re
import os

# All the device buttons are part of event0, which appears as a keyboard
# 	buttons along the edge are: 1, 2, 3, 4, m
# 	next to the knob: ESC
#	knob click: Enter
# Turning the knob is a separate device, event1, which also appears as a keyboard
#	turning the knob corresponds to the left and right arrow keys

DEV_BUTTONS = '/dev/input/event0'
DEV_KNOB = '/dev/input/event1'

# for event0, these are the keycodes for buttons
BUTTONS_CODE_MAP = {
    2: '1',
    3: '2',
    4: '3',
    5: '4',
    50: 'm',
    28: 'ENTER',
    1: 'ESC',
}

# for event1, when the knob is turned it is always keycode 6, but value changes on direction
KNOB_LEFT = 4294967295  # actually -1 but unsigned int so wraps around
KNOB_RIGHT = 1

# https://github.com/torvalds/linux/blob/v5.5-rc5/include/uapi/linux/input.h#L28
# long int, long int, unsigned short, unsigned short, unsigned int
EVENT_FORMAT = 'llHHI'
EVENT_SIZE = struct.calcsize(EVENT_FORMAT)

logformat = logging.Formatter('%(created)f %(levelname)s [%(filename)s:%(lineno)d]: %(message)s')
logger = logging.getLogger('buttons')
logger.setLevel(logging.DEBUG)

fh = logging.FileHandler('/var/log/buttons.log')
fh.setLevel(logging.DEBUG)
fh.setFormatter(logformat)
logger.addHandler(fh)

ch = logging.StreamHandler()
ch.setLevel(logging.DEBUG)
ch.setFormatter(logformat)
logger.addHandler(ch)

# create variables
global brightness
brightness = 10

lastPresses = [None]

global editMode
editMode = False

# get brightness level from script
script = open("/scripts/setup_backlight.sh", "r")
data = script.readlines()
script.close()
    
brightness = data[4]
brightness = int(re.search(r'BRIGHTNESS=(\d+)', data[4]).group(1))

data.clear()

logger.info(brightness)

def translate_event(etype: int, code: int, value: int) -> str:
    # Translate combination of type, code, value into string representing button pressed

    if etype == 1 and value == 1:
        # button press
        if code in BUTTONS_CODE_MAP:
            return BUTTONS_CODE_MAP[code]
    if etype == 2:
        if code == 6:
            # knob turn
            if value == KNOB_RIGHT:
                return 'RIGHT'
            if value == KNOB_LEFT:
                return 'LEFT'
    return 'UNKNOWN'

def checkLastPresses(key_presses):
    if len(key_presses) < 3:
        return
    
    last4KeyPresses = key_presses[-3:]
    
    if all(key == '5' for key in last4KeyPresses) == True:
        logger.info("Sending command to enter brightness edit mode.")
        cmd_switch()
        
        # reset lastPresses list
        global lastPresses
        lastPresses = [None]
    
    else:
        return 
    
def handle_button(pressed_key: str):
    # Decide what to do in response to a button press

    logger.info(f'Pressed button: {pressed_key}')
    # check for presets
    if pressed_key in ['1', '2', '3', '4', 'm']:
        if pressed_key == 'm':
            pressed_key = '5'
 
        if pressed_key == '1':
            cmd_toggle()

        if pressed_key == '2':
            cmd_toggle()
 
        if pressed_key == '3':
            cmd_toggle()
        
        if pressed_key == '4':
            cmd_toggle()
        
    elif pressed_key in ['ESC', 'ENTER', 'LEFT', 'RIGHT']:
        if pressed_key == 'ENTER':
            cmd_toggle()
        elif pressed_key == 'LEFT':
            cmd_raise()                     # these are reversed since brightness is higher if the number is lower
        elif pressed_key == 'RIGHT':
            cmd_lower()                     # these are reversed since brightness is higher if the number is lower
        if pressed_key == 'ESC':
            cmd_toggle()
            
    # add button press to list
    lastPresses.append(pressed_key)
                 
# stop backlight script with systemctl, echo brightness value to location, restart backlight script when exiting
      
def cmd_toggle():
    global editMode, brightness
    
    # save brightness values to file
    script = open("/scripts/setup_backlight.sh", "r")
    data = script.readlines()
    script.close()
    
    script = open("/scripts/setup_backlight.sh", "w")
    data[4] = data[4] = f"BRIGHTNESS={brightness} \n"
    script.writelines(data)
    script.close()
    
    # Exit brightness edit mode
    logger.info("Exiting brightness edit mode.")
    os.system("systemctl start backlight.service")
    editMode = False
    
    logger.info(f'Brightness saved in script as: {brightness}')
    
def cmd_lower():
    global editMode, brightness
    
    # Lower brightness value
    
    if editMode == True:
        brightness = brightness - LEVEL_INCREMENT

        if brightness < 5:
            logger.info("Setting brightness to maximum 5")
            brightness = 5
            
        logger.info(f'Setting brightness to {brightness}')
        os.system(f'echo {brightness} > /sys/devices/platform/backlight/backlight/aml-bl/brightness')
        
    else:
        logger.info("Not in brightness edit mode!")
                    
def cmd_raise():
    global editMode, brightness
    
    # Raise brightness value
    if editMode == True:
        brightness = brightness + LEVEL_INCREMENT

        if brightness > 250:
            logger.info("Setting brightness to minimum 250")
            brightness = 250
            
        logger.info(f'Setting brightness to {brightness}')
        os.system(f'echo {brightness} > /sys/devices/platform/backlight/backlight/aml-bl/brightness')
    
    else:
        logger.info("Not in brightness edit mode!")
         
def cmd_switch():
    global editMode, brightness
    
    # Enter brightness edit mode
    logger.info("Entering brightness edit mode.")
    os.system("systemctl stop backlight.service")
    editMode = True  
    
class EventListener():
    # Listen to a specific /dev/eventX and call handle_button 

    def __init__(self, device: str) -> None:
        self.device = device
        self.stopper = ThreadEvent()
        self.thread:Thread = None
        self.start()

    def start(self):
        # Start listening thread
        
        logger.info(f'Starting listener for {self.device}')
        self.thread = Thread(target=self.listen, daemon=True)
        self.thread.start()

    def stop(self):
        # Stop listening thread

        logger.info(f'Stopping listener for {self.device}')
        self.stopper.set()
        self.thread.join()

    def listen(self):
        # To run in thread, listen for events and call handle_buttons if applicable

        with open(self.device, "rb") as in_file:
            event = in_file.read(EVENT_SIZE)
            while event and not self.stopper.is_set():
                if self.stopper.is_set():
                    break
                (_sec, _usec, etype, code, value) = struct.unpack(EVENT_FORMAT, event)
                # logger.info(f'Event: type: {etype}, code: {code}, value:{value}')
                event_str = translate_event(etype, code, value)
                if event_str in ['1', '2', '3', '4', 'm', 'ENTER', 'ESC', 'LEFT', 'RIGHT']:
                    handle_button(event_str)
                event = in_file.read(EVENT_SIZE)

if __name__ == '__main__':
    logger.info('Starting buttons listeners')
    EventListener(DEV_BUTTONS)
    EventListener(DEV_KNOB)
    
    while True:
        if len(lastPresses) > 5:
            # delete oldest button press
            del lastPresses[0]
        
        # check if last 3 key presses were the settings menu
        checkLastPresses(lastPresses)    
        time.sleep(1)
