
# python script to setup hotspot connection on raspberry pi
# run setup_host script first, then this script with python
# the pi will prefer connecting to your phones hotspot over your main network


# required imports
import getpass
import os
import sys

# script must be run as root, so check if user has run with sudo
if os.geteuid() != 0:
    print('Need to run with sudo!')
    sys.exit(1)

# used variables
profileName = "Phone Hotspot"
config_path = "/etc/NetworkManager/system-connections/CarThingHotspot.nmconnection" # do NOT edit this, unless you want to only rename the file

# get ssid from user
SSID = str(input("Please enter the SSID of your phone's hotspot. \n"))

# get password from user
password = getpass.getpass("Please enter the password of your phone's hotspot. Your input is hidden to protect your hotspot password. \n")

# check if network config file exists
if not os.path.exists(config_path):
    config = open(config_path, "w+")
else:
    config = open(config_path, "r+")
    existing_data = config.read()
    if existing_data:
        input("The configuration file already contains data. Press enter if you would like to continue, and overwrite the data in the file. \n")
        config.seek(0)
        config.truncate()

# create connection profile in networkmanager
config.write(f"""[connection]
id=CarThingHotspot
type=wifi
autoconnect-priority=50

[wifi]
mode=infrastructure
ssid={SSID}

[wifi-security]
key-mgmt=wpa-psk
psk={password}

[ipv4]
method=auto

[ipv6]
addr-gen-mode=default
method=auto

[proxy]
""")
config.close()

# change permissions of file before reload
os.system(f"chmod 600 {config_path}")

# reload networkmanager
print("Reloading NetworkManager to apply changes...")
os.system("nmcli connection reload")

print("\n")
print("Completed successfully!")
print("This will attempt to connect to your phone's hotspot first if available, then fall back to connecting to your home network.")