################################################################################
#
# nocturned
#
################################################################################

NOCTURNED_VERSION = 1c94247
NOCTURNED_SITE_METHOD = git
NOCTURNED_SITE = ssh://git@github.com/usenocturne/nocturned-private.git

$(eval $(cargo-package))
