# Shared monorepo fetch for the recipes built out of this repo (nocturned,
# nocturne-ui). Both are packages of one tree, so the URL is declared once
# here rather than copied into each recipe - and, crucially, once more into
# kas/nocturne-local.yml's SRC_URI:remove, which is where the two previously
# drifted apart.
#
# No gitsm:// - there are no submodules (iap2 is an in-tree path dependency).
#
# NOCTURNE_MONOREPO_SRC_URI is referenced verbatim by the SRC_URI:remove lines
# in kas/nocturne-local.yml. externalsrc.bbclass calls bb.fetch.get_hashvalue()
# over SRC_URI before it strips the git entry itself, which resolves AUTOREV
# over the network even though the build reads from the local tree. Removing
# the entry up front keeps local builds offline and independent of whether the
# branch has the local commits. :remove values are expanded lazily in the
# recipe's datastore, so that indirection resolves correctly without depending
# on anonymous-python ordering.

NOCTURNE_MONOREPO_URL ?= "github.com/usenocturne/nocturne"
NOCTURNE_MONOREPO_SRC_URI ?= "git://${NOCTURNE_MONOREPO_URL}.git;protocol=https;branch=main;destsuffix=${BP}"

HOMEPAGE = "https://${NOCTURNE_MONOREPO_URL}"

SRC_URI = "${NOCTURNE_MONOREPO_SRC_URI}"
SRCREV = "${AUTOREV}"
