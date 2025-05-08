#!/bin/sh
set -e

usage() {
  echo
  echo "Usage: github_release_source -r REPO [-d DESTINATION] [-v VERSION]"
  echo "           if -d is not used, the current working directory is used"
  exit 1
}

while getopts "r:d:v" OPTS; do
  case ${OPTS} in
r) REPO=${OPTARG} ;;
    d) DEST=${OPTARG} ;;
    v) VER=${OPTARG} ;;
    *) usage ;;
  esac
done

[ -z "$REPO" ] && echo "Need a repo to download from in username/repo format (-r)" && usage
[ -z "$VER" ] && echo "Need a specific version (tag) to download" && usage
[ -z "$DEST" ] && DEST="$(pwd)"

echo "Fetching $VER version of $REPO"

wget "https://github.com/$REPO/archive/refs/tags/$VER.zip"

if [ ! -d "$DEST" ]; then
  mkdir -p "$DEST"
  unzip -d "$DEST" "$VER.zip"
fi
