################################################################################
#
# nocturned
#
################################################################################

NOCTURNED_VERSION = ef94d18
NOCTURNED_SITE_METHOD = git
NOCTURNED_SITE = ssh://git@github.com/usenocturne/nocturned-private.git

$(eval $(cargo-package))
