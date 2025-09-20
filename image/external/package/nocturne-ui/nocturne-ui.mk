################################################################################
#
# nocturne-ui
#
################################################################################

NOCTURNE_UI_VERSION = nocturne-app
NOCTURNE_UI_SOURCE = nocturne-ui.zip
NOCTURNE_UI_SITE = https://nightly.link/usenocturne/nocturne-ui/workflows/build/$(NOCTURNE_UI_VERSION)
NOCTURNE_UI_METHOD = wget

define NOCTURNE_UI_EXTRACT_CMDS
	unzip $(NOCTURNE_UI_DL_DIR)/$(NOCTURNE_UI_SOURCE) -d $(@D)/nocturne-ui
endef

define NOCTURNE_UI_INSTALL_TARGET_CMDS
	rm -rf $(TARGET_DIR)/etc/nocturne/ui
	mkdir -p $(TARGET_DIR)/etc/nocturne/ui
	cp -r $(@D)/nocturne-ui/* $(TARGET_DIR)/etc/nocturne/ui/
endef

$(eval $(generic-package))
