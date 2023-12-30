#!/usr/bin/env bash

# update scripts and service files on a locally attached device
#   will not overwrite any existing buttons_settings.py or chromium_settings.sh
#   will not touch usbgadget
#   this is intended to run on the host device, and expects key-based ssh authentication has already been setup with superbird


deploy_service() {
    # copy given service file and restart that service
    SVC_NAME="$1"
    echo "deploying $SVC_NAME"
    ssh superbird@superbird "sudo touch /lib/systemd/system/$SVC_NAME"
    ssh superbird@superbird "sudo chown superbird /lib/systemd/system/$SVC_NAME"
    scp "./systemd/$SVC_NAME" superbird@superbird:/lib/systemd/system/
    ssh superbird@superbird "sudo systemctl restart $SVC_NAME"
    ssh superbird@superbird "sudo ln -sf /lib/systemd/system/$SVC_NAME /etc/systemd/system/multi-user.target.wants/$SVC_NAME"
}

deploy_script() {
    # copy given script file
    #   does not change file mode, presumes new file is correct mode already
    SCR_NAME="$1"
    scp "./scripts/$SCR_NAME" superbird@superbird:/scripts/
}

deploy_script_if_missing() {
    # deploy script only if it is missing
    #   does not change file mode, presumes new file is correct mode already
    SCR_NAME="$1"
    SCR_MISSING=$(ssh superbird@superbird "if [ ! -f /scripts/$SCR_NAME ]; then echo missing; fi")
    if [ "$SCR_MISSING" == "missing" ]; then
        deploy_script "$SCR_NAME"
    fi
}

#### Entrypoint

echo ""
echo "Upgrading locally connected device"

echo ""
echo "Installing packages"
# install packages, most of which should already be installed
ssh superbird@superbird "sudo apt update && sudo apt install -y --no-install-recommends --no-install-suggests chromium python3-minimal python3-pip"

# install required python packages via pip
ssh superbird@superbird "sudo chown -R superbird /scripts"
deploy_script requirements.txt
ssh superbird@superbird "sudo python3 -m pip install -r /scripts/requirements.txt --break-system-packages"

echo ""
echo "Deploying scripts and services"

# Now deploy scripts and services


deploy_script_if_missing buttons_settings.py
deploy_script_if_missing chromium_settings.sh


echo ""
echo "You can ignore the warnings about reloading units"
echo ""

deploy_script buttons_app.py
deploy_script clear_display.sh
deploy_script setup_backlight.sh
deploy_script setup_display.sh
deploy_script setup_usbgadget.sh
deploy_script setup_vnc.sh
deploy_script start_buttons.sh
deploy_script start_chromium.sh


deploy_service backlight.service
deploy_service buttons.service
deploy_service chromium.service
deploy_service vnc.service

echo ""
echo "Done deploying to device"
echo ""
