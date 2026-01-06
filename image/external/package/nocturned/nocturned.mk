################################################################################
#
# nocturned
#
################################################################################

NOCTURNED_VERSION = 783fb41
NOCTURNED_SITE_METHOD = git
NOCTURNED_SITE = ssh://git@github.com/usenocturne/nocturned-private.git

$(eval $(cargo-package))
