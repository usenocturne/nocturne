################################################################################
#
# nocturned
#
################################################################################

NOCTURNED_VERSION = e35bdad
NOCTURNED_SITE_METHOD = git
NOCTURNED_SITE = ssh://git@github.com/usenocturne/nocturned-private.git

$(eval $(cargo-package))
