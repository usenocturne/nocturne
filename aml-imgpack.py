#!/usr/bin/env python3
"""
Resource packer/unpacker for Amlogic Logo image files
    License: GPL-2.0
    https://github.com/bishopdynamics/aml-imgpack
"""
# pylint: disable=line-too-long,missing-class-docstring,missing-function-docstring,consider-using-f-string,invalid-name,broad-exception-raised,protected-access

from __future__ import annotations

import struct
import argparse
import binascii

from pathlib import Path

AML_RES_IMG_VERSION_V1 = 0x01
AML_RES_IMG_VERSION_V2 = 0x02
AML_RES_IMG_ITEM_ALIGN_SZ = 16
AML_RES_IMG_VERSION = 0x01
AML_RES_IMG_V1_MAGIC_LEN = 8
AML_RES_IMG_V1_MAGIC = b'AML_RES!' # 8 chars
AML_RES_IMG_HEAD_SZ = AML_RES_IMG_ITEM_ALIGN_SZ * 4 # 64
AML_RES_ITEM_HEAD_SZ = AML_RES_IMG_ITEM_ALIGN_SZ * 4 # 64
IH_MAGIC = 0x27051956 # Image Magic Number
IH_NMLEN = 32 # Image Name Length
ARCH_ARM = 8


# typedef struct {
#     __u32   crc;    //crc32 value for the resouces image
#     __s32   version;//current version is 0x01
#     __u8    magic[AML_RES_IMG_V1_MAGIC_LEN];  //resources images magic
#     __u32   imgSz;  //total image size in byte
#     __u32   imgItemNum;//total item packed in the image
#     __u32   alignSz;//AML_RES_IMG_ITEM_ALIGN_SZ
#     __u8    reserv[AML_RES_IMG_HEAD_SZ - 8 * 3 - 4];
# }AmlResImgHead_t;

# typedef struct pack_header{
#     unsigned int    magic;  /* Image Header Magic Number    */
#     unsigned int    hcrc;   /* Image Header CRC Checksum    */
#     unsigned int    size;   /* Image Data Size      */
#     unsigned int    start;  /* item data offset in the image*/
#     unsigned int    end;    /* Entry Point Address      */
#     unsigned int    next;   /* Next item head offset in the image*/
#     unsigned int    dcrc;   /* Image Data CRC Checksum  */
#     unsigned char   index;  /* Operating System     */
#     unsigned char   nums;   /* CPU architecture     */
#     unsigned char   type;   /* Image Type           */
#     unsigned char   comp;   /* Compression Type     */
#     char    name[IH_NMLEN]; /* Image Name       */
# }AmlResItemHead_t;


class AmlResourcesImage(object):
    def __init__(self):
        self.header = AmlResImgHead()
        self.items = []

    @classmethod
    def unpack_from(cls, fp) -> AmlResourcesImage:
        img = cls()
        fp.seek(0)
        img.header = AmlResImgHead.unpack_from(fp)
        while True:
            item = AmlResItem.unpack_from(fp)
            img.items.append(item)
            if item.next == 0:
                break
            fp.seek(item.next)
        return img

    def pack(self) -> bytes:
        packed = bytes()

        data_pack = bytes()
        for item in self.items:
            item.start = len(data_pack) + AmlResImgHead._size + (AmlResItem._size * len(self.items))
            item.size = len(item.data)
            data_pack += item.data
            data_pack += struct.pack("%ds" % (len(data_pack) % self.header.alignSz), b"\0" * self.header.alignSz)

        for i, item in enumerate(self.items):
            item.index = i
            if i < (len(self.items) - 1):
                item.next = AmlResImgHead._size + (AmlResItem._size * (i + 1))
            packed += item.pack()
        self.header.imgItemNum = len(self.items)
        self.header.imgSz = len(packed) + AmlResImgHead._size
        return self.header.pack() + packed + data_pack


class AmlResItem:
    _format = "IIIIIIIBBBB%ds" % IH_NMLEN
    _size = struct.calcsize(_format)
    magic = IH_MAGIC
    hcrc = 0
    size = 0
    start = 0
    end = 0
    next = 0
    dcrc = 0
    index = 0
    nums = ARCH_ARM
    type = 0
    comp = 0
    name = ""
    data = ""

    @classmethod
    def from_file(cls, file:Path) -> AmlResItem:
        item = cls()
        with open(file, mode='br') as fp:
            item.data = fp.read()
        item.dcrc = binascii.crc32(item.data) & 0xFFFFFFFF
        item.size = len(item.data)
        item.name = file.stem
        return item

    @classmethod
    def unpack_from(cls, fp) -> AmlResItem:
        h = cls()
        h.magic, h.hcrc, h.size, h.start, h.end, h.next, h.dcrc, h.index, \
        h.nums, h.type, h.comp, h.name = struct.unpack(h._format, fp.read(h._size))
        h.name = h.name.rstrip(b'\0')
        if h.magic != IH_MAGIC:
            raise Exception("Invalid item header magic, should 0x%x, is 0x%x" % (IH_MAGIC, h.magic))
        fp.seek(h.start)
        h.data = fp.read(h.size)
        return h

    def pack(self) -> bytes:
        packed = struct.pack(self._format, self.magic, self.hcrc, self.size, self.start, self.end, self.next, self.dcrc, self.index, self.nums,self.type, self.comp, self.name.encode('utf-8'))
        return packed

    def __repr__(self) -> str:
        return "AmlResItem(name=%s start=0x%x size=%d)" % (self.name, self.start, self.size)


class AmlResImgHead(object):
    _format = "Ii%dsIII%ds" % (AML_RES_IMG_V1_MAGIC_LEN, AML_RES_IMG_HEAD_SZ - 8 * 3 - 4)
    _size = struct.calcsize(_format)
    crc = 0
    version = AML_RES_IMG_VERSION_V2
    magic = AML_RES_IMG_V1_MAGIC
    imgSz = 0
    imgItemNum = 0
    alignSz = AML_RES_IMG_ITEM_ALIGN_SZ
    reserv = ""

    @classmethod
    def unpack_from(cls, fp) -> AmlResImgHead:
        h = cls()
        h.crc, h.version, h.magic, h.imgSz, h.imgItemNum, h.alignSz, h.reserv = struct.unpack(h._format, fp.read(h._size))
        if h.magic != AML_RES_IMG_V1_MAGIC:
            raise Exception("Magic is not right, should %s, is %s" % (AML_RES_IMG_V1_MAGIC, h.magic))
        if h.version > AML_RES_IMG_VERSION_V2:
            raise Exception("res-img version %d not supported" % h.version)
        return h

    def pack(self) -> bytes:
        packed = struct.pack(self._format, self.crc, self.version, self.magic, self.imgSz, self.imgItemNum, self.alignSz, self.reserv.encode('utf-8'))
        return packed

    def __repr__(self) -> str:
        return "AmlResImgHead(crc=0x%x version=%d imgSz=%d imgItemNum=%d alignSz=%d)" % \
            (self.crc, self.version, self.imgSz, self.imgItemNum, self.alignSz)



def list_items(logo_img_file):
    print("Listing assets in %s" % logo_img_file)
    with open(logo_img_file, mode='rb') as fp:
        img = AmlResourcesImage.unpack_from(fp)
        print(img.header)
        for item in img.items:
            print("    %s" % item)


def unpack_image_file(logo_img_file):
    print("Unpacking assets in %s" % logo_img_file)
    with open(logo_img_file, mode='rb') as fp:
        img = AmlResourcesImage.unpack_from(fp)
        for item in img.items:
            print("  Unpacking %s" % item.name.decode('utf-8'))
            with open("%s.bmp" % item.name.decode('utf-8'), "wb") as item_fp:
                item_fp.write(item.data)


def pack_image_file(outfile, assets):
    print("Packing files in %s:" % outfile)
    img = AmlResourcesImage()
    img.items = []
    for asset in assets:
        img.items.append(AmlResItem.from_file(Path(asset)))
    for item in img.items:
        print("  %s (%d bytes)" % (item.name, item.size))
    with open(outfile, "wb") as fp:
        fp.write(img.pack())


def main():
    parser = argparse.ArgumentParser(description='Pack and unpack amlogic uboot images')
    parser.add_argument("--unpack", help="Unpack image file", action="store_true")
    parser.add_argument("--pack", help="Pack image file")
    parser.add_argument('assets', metavar='file', type=str, nargs='+', help='an integer for the accumulator')

    args = parser.parse_args()
    if args.unpack:
        unpack_image_file(args.assets[0])
    elif args.pack:
        pack_image_file(args.pack, args.assets)
    else:
        list_items(args.assets[0])

main()
