#!/bin/sh

colour_echo ">> Copy images"
rm -rf ${OUTPUT_PATH:?}/*
cp ${IMAGE_PATH}/datafs.ext4 ${RES_PATH}/env.txt ${OUTPUT_PATH}/
cp ${IMAGE_PATH}/system.ext4 ${OUTPUT_PATH}/system_a.ext2
cp ${IMAGE_PATH}/system.ext4 ${OUTPUT_PATH}/system_b.ext2

# todo: generate update files + checksums
