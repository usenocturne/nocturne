################################################################################
#
# nocturned
#
################################################################################

NOCTURNED_VERSION = d737c71
NOCTURNED_SITE_METHOD = git
NOCTURNED_SITE = ssh://git@github.com/usenocturne/nocturned-private.git

$(eval $(cargo-package))
