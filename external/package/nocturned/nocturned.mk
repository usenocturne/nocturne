################################################################################
#
# nocturned
#
################################################################################

NOCTURNED_VERSION = 9f668fb
NOCTURNED_SITE_METHOD = git
NOCTURNED_SITE = ssh://git@github.com/usenocturne/nocturned-private.git

$(eval $(cargo-package))
