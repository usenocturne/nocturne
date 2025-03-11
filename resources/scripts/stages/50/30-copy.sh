#!/bin/sh

colour_echo ">> Copy images"
rm -rf ${OUTPUT_PATH:?}/*
cp ${IMAGE_PATH}/boot.bin ${RES_PATH}/flash/env.txt ${RES_PATH}/flash/meta.json ${OUTPUT_PATH}/
cp ${IMAGE_PATH}/boot.vfat ${IMAGE_PATH}/system.ext4 ${IMAGE_PATH}/data.ext4 ${IMAGE_PATH}/swap.bin ${OUTPUT_PATH}/


# todo: generate update files + checksums
