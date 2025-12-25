################################################################################
#
# nocturned
#
################################################################################

NOCTURNED_VERSION = e238f71
NOCTURNED_SITE_METHOD = git
NOCTURNED_SITE = ssh://git@github.com/usenocturne/nocturned-private.git

$(eval $(cargo-package))
