################################################################################
#
# fastfetch
#
################################################################################

FASTFETCH_VERSION = 2.54.0
FASTFETCH_SITE = https://github.com/fastfetch-cli/fastfetch/archive/refs/tags
FASTFETCH_SOURCE = $(FASTFETCH_VERSION).tar.gz
FASTFETCH_LICENSE = MIT
FASTFETCH_DEPENDENCIES = host-pkgconf cjson
FASTFETCH_CMAKE_BACKEND = ninja

define FASTFETCH_INSTALL_TARGET_CMDS
	$(INSTALL) -D $(@D)/fastfetch -m 0755 $(TARGET_DIR)/usr/bin/fastfetch

	mkdir -p $(TARGET_DIR)/etc/fastfetch
	$(INSTALL) -D $(BR2_EXTERNAL)/package/fastfetch/config.jsonc $(TARGET_DIR)/etc/fastfetch/config.jsonc
	$(INSTALL) -D $(BR2_EXTERNAL)/package/fastfetch/logo.txt $(TARGET_DIR)/etc/fastfetch/logo.txt
endef

$(eval $(cmake-package))
