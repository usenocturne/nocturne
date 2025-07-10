#!/bin/sh

(
  cd "$ROOTFS_PATH" || exit 1
  rm -rf tmp/* usr/share/libwacom/* usr/share/man/* usr/share/i18n/locales/cns11643_stroke usr/share/i18n/locales/iso14651_t1_common usr/share/i18n/locales/iso14651_t1_pinyin

  find usr/share/locale -mindepth 1 -maxdepth 1 -type d ! -name 'en*' -exec rm -rf {} + 2> /dev/null
  rm -rf usr/share/locale/en_CA usr/share/locale/en_GB

  find usr/share/i18n/charmaps -mindepth 1 -maxdepth 1 ! -name 'UTF-8.gz' -exec rm -rf {} + 2> /dev/null
)
