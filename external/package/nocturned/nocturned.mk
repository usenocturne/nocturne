################################################################################
#
# nocturned
#
################################################################################

NOCTURNED_VERSION = v2.0.6
NOCTURNED_SITE_METHOD = git
NOCTURNED_SITE = https://github.com/usenocturne/nocturned.git

$(eval $(cargo-package))
