################################################################################
#
# stock-blobs
#
################################################################################

STOCK_BLOBS_VERSION = 8.9.2
STOCK_BLOBS_SOURCE = stock-blobs-$(STOCK_BLOBS_VERSION).tar.gz
STOCK_BLOBS_SITE = $(TOPDIR)/../dl/stock-blobs
STOCK_BLOBS_SITE_METHOD = local

define STOCK_BLOBS_INSTALL_TARGET_CMDS
	$(TAR) -C $(TARGET_DIR) -xf $(@D)/$(STOCK_BLOBS_SOURCE)
	$(STOCK_BLOBS_PKGDIR)/post-install.sh $(TARGET_DIR)
endef

define STOCK_BLOBS_INSTALL_INIT_SYSV
	$(INSTALL) -D -m 755 $(BR2_EXTERNAL)/package/stock-blobs/S51display \
		$(TARGET_DIR)/etc/init.d/S51display
endef

$(eval $(generic-package))
