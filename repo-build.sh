#!/bin/sh

# Build Nocturne packages, provided the path to a clone of usenocturne/void-repo

[ -z "$1" ] && echo "Usage: ./repo-build.sh [path-to-nocturne-void-repo]" && exit 1

cd "$1"
arch="$(uname -m)"
build_pkg() {
    [ -z "$1" ] && echo "Need package name" && return
    ./foreign-xbps-src -A "$arch" -a aarch64 pkg "$1"
}

# all other packages will be built automatically because of being dependencies
build_pkg nocturne-base
