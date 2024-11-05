#!/usr/bin/env bash

# Shared config for image scripts
# shellcheck disable=SC2034

# where to find an existing superbird device dump, to use for creating a debian image
EXISTING_DUMP="./stock"

# Network info
HOST_NAME="superbird"
USBNET_PREFIX="192.168.7"  # usb network will use .1 as host device, and .2 for superbird

# User info
USER_NAME="superbird"
# generate hash: openssl passwd -6 "superbird"
#   shellcheck disable=SC2016
USER_PASS_HASH='$6$zeM8ZwO/Xke05h6X$UtmM0sIBznj4hxmd/UGUO1YHUr0emOn.9u7G1yQRVGR4XutYCstDzVLzpUw9PNWrhYRAEg73ovkC4JNPFlSmI1'

# config for debootstrap
ARCHITECTURE="arm64"
DISTRO_REPO_URL="http://deb.debian.org/debian/"
DISTRO_BRANCH="bookworm"
DISTRO_VARIANT="minbase"

# you can add extra packages here to install during stage 2
#   will be installed like this (in chroot): apt install -y --no-install-recommends --no-install-suggests $EXTRA_PACKAGES
EXTRA_PACKAGES=""

# timezone and locale
TIMEZONE="America/Toronto"
LOCALE="en_US.UTF-8"