"""
Settings for /scripts/buttons_app.py
"""
# pylint: disable=line-too-long

# Home Assistant address, including port
HA_SERVER = 'https://192.168.1.144:8123'

# long-lived token, https://www.home-assistant.io/docs/authentication/#your-account-profile
HA_TOKEN = 'insert-token-here'

# Light entity to control with knob
ROOM_LIGHT = 'light.office'

# when you turn the knob, brightness will go up or down by this amount
#   brightness is 0 - 255
LEVEL_INCREMENT = 32

# assign scene/automation/script to buttons along the edge
#   anything that supports turn_on() should work
#   blank entries are ignored

ROOM_SCENES = [
    'scene.office_bright',  # 1
    'scene.office_half',  # 2
    'scene.office_blues',  # 3
    '',  # 4
    '',  # 5 aka m (recessed menu button)
]

# assign a scene/automation/script to the button next to the knob, aka ESC
ESC_SCENE = 'scene.office_bright'
