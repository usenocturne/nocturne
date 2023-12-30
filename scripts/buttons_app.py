"""
Buttons monitoring, to integrate with Home Assistant
"""
# pylint: disable=global-statement,line-too-long,broad-exception-caught,logging-fstring-interpolation

# https://stackoverflow.com/questions/5060710/format-of-dev-input-event

import time
import struct
import contextlib
import warnings
import logging

from threading import Thread
from threading import Event as ThreadEvent

import requests
import urllib3
from urllib3.exceptions import InsecureRequestWarning

from homeassistant_api import Client

# user-configurable settings are all in button_settings.py
from buttons_settings import ROOM_LIGHT, ROOM_SCENES, ESC_SCENE, LEVEL_INCREMENT
from buttons_settings import HA_SERVER, HA_TOKEN

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

# global for HA Client
HA_CLIENT:Client = None

# suppress warnings about invalid certs
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
old_merge_environment_settings = requests.Session.merge_environment_settings

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


@contextlib.contextmanager
def no_ssl_verification():
    """
    context manager that monkey patches requests and changes it so that verify=False is the default and suppresses the warning
        https://stackoverflow.com/questions/15445981/how-do-i-disable-the-security-certificate-check-in-python-requests
    """
    opened_adapters = set()

    def merge_environment_settings(self, url, proxies, stream, verify, cert):
        # Verification happens only once per connection so we need to close
        # all the opened adapters once we're done. Otherwise, the effects of
        # verify=False persist beyond the end of this context manager.
        opened_adapters.add(self.get_adapter(url))

        settings = old_merge_environment_settings(self, url, proxies, stream, verify, cert)
        settings['verify'] = False

        return settings

    requests.Session.merge_environment_settings = merge_environment_settings

    try:
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', InsecureRequestWarning)
            yield
    finally:
        requests.Session.merge_environment_settings = old_merge_environment_settings

        for adapter in opened_adapters:
            try:
                adapter.close()
            except Exception:
                pass


def translate_event(etype: int, code: int, value: int) -> str:
    """
    Translate combination of type, code, value into string representing button pressed
    """
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


def handle_button(pressed_key: str):
    """
    Decide what to do in response to a button press
    """
    logger.info(f'Pressed button: {pressed_key}')
    # check for presets
    if pressed_key in ['1', '2', '3', '4', 'm']:
        if pressed_key == 'm':
            pressed_key = '5'
        if len(ROOM_SCENES) >= int(pressed_key):
            preset = ROOM_SCENES[int(pressed_key) - 1]
            cmd_scene(preset)
    elif pressed_key in ['ESC', 'ENTER', 'LEFT', 'RIGHT']:
        if pressed_key == 'ENTER':
            cmd_toggle()
        elif pressed_key == 'LEFT':
            cmd_lower()
        elif pressed_key == 'RIGHT':
            cmd_raise()
        if pressed_key == 'ESC':
            cmd_scene(ESC_SCENE)


def get_light_level(entity_id: str) -> int:
    """
    Get current brightness of a light
    """
    light = HA_CLIENT.get_entity(entity_id=entity_id)
    level = light.get_state().attributes['brightness']
    if level is None:
        level = 0
    return level


def set_light_level(entity_id: str, level: int):
    """
    Set light brightness
    """
    light_domain = HA_CLIENT.get_domain('light')
    light_domain.turn_on(entity_id=entity_id, brightness=level)


def cmd_scene(entity_id: str):
    """
    Recall a scene / automation / script by entity id
        you can use any entity where turn_on is valid
    """
    if entity_id == '':
        return
    domain = entity_id.split('.')[0]
    logger.info(f'Recalling {domain}: {entity_id}')
    scene_domain = HA_CLIENT.get_domain(domain)
    scene_domain.turn_on(entity_id=entity_id)


def cmd_toggle():
    """
    Toggle the light for this room on/off
    """
    logger.info(f'Toggling state of light: {ROOM_LIGHT}')
    light_domain = HA_CLIENT.get_domain('light')
    light_domain.toggle(entity_id=ROOM_LIGHT)


def cmd_lower():
    """
    Lower the level of the light for this room
    """
    logger.info(f'Lowering brightness of {ROOM_LIGHT}')
    current_level = get_light_level(ROOM_LIGHT)
    new_level = current_level - LEVEL_INCREMENT
    new_level = max(new_level, 0)
    logger.info(f'New level: {new_level}')
    if new_level < current_level:
        set_light_level(ROOM_LIGHT, new_level)


def cmd_raise():
    """
    Raise the level of the light for this room
    """
    logger.info(f'Raising brightness of {ROOM_LIGHT}')
    current_level = get_light_level(ROOM_LIGHT)
    new_level = current_level + LEVEL_INCREMENT
    new_level = min(new_level, 255)
    logger.info(f'New level: {new_level}')
    if new_level > current_level:
        set_light_level(ROOM_LIGHT, new_level)


class EventListener():
    """
    Listen to a specific /dev/eventX and call handle_button 
    """
    def __init__(self, device: str) -> None:
        self.device = device
        self.stopper = ThreadEvent()
        self.thread:Thread = None
        self.start()

    def start(self):
        """
        Start listening thread
        """
        logger.info(f'Starting listener for {self.device}')
        self.thread = Thread(target=self.listen, daemon=True)
        self.thread.start()

    def stop(self):
        """
        Stop listening thread
        """
        logger.info(f'Stopping listener for {self.device}')
        self.stopper.set()
        self.thread.join()

    def listen(self):
        """
        To run in thread, listen for events and call handle_buttons if applicable
        """
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
    # NOTE: we use no_ssl_verification context handler to nuke the obnoxiously difficult-to-disable SSL verification of requests
    logger.info('Starting buttons listeners')
    with no_ssl_verification():
        HA_CLIENT = Client(f'{HA_SERVER}/api', HA_TOKEN, global_request_kwargs={'verify': False}, cache_session=False)
        EventListener(DEV_BUTTONS)
        EventListener(DEV_KNOB)
        while True:
            time.sleep(1)
