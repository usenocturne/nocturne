################################################################################
#
# nocturned
#
################################################################################

NOCTURNED_VERSION = e7d8a68
NOCTURNED_SITE_METHOD = git
NOCTURNED_SITE = ssh://git@github.com/usenocturne/nocturned-private.git

$(eval $(cargo-package))
