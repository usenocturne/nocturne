################################################################################
#
# static-web-server
#
################################################################################

STATIC_WEB_SERVER_VERSION = v2.38.0
STATIC_WEB_SERVER_SITE = https://github.com/static-web-server/static-web-server/releases/download/$(STATIC_WEB_SERVER_VERSION)
STATIC_WEB_SERVER_SOURCE = static-web-server-$(STATIC_WEB_SERVER_VERSION)-armv7-unknown-linux-musleabihf.tar.gz

define STATIC_WEB_SERVER_INSTALL_TARGET_CMDS
    $(INSTALL) -D -m 0755 $(@D)/static-web-server $(TARGET_DIR)/usr/bin/static-web-server
endef

$(eval $(generic-package))
