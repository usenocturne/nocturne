################################################################################
#
# nocturned
#
################################################################################

NOCTURNED_VERSION = b2b7901
NOCTURNED_SITE_METHOD = git
NOCTURNED_SITE = ssh://git@github.com/usenocturne/nocturned-private.git

$(eval $(cargo-package))
