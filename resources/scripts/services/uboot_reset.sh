#!/bin/sh
mount -o remount,rw /uboot

uboot_tool reset_counter

sync
mount -o remount,ro /uboot
