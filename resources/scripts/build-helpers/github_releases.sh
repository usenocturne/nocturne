#!/bin/sh
set -e

usage() {
  echo
  echo "Usage: github_releases -r REPO -a ASSET [-s] [-d DESTINATION -v VERSION]"
  echo "           if -d is not used, the current working directory is used"
  echo "           if -v is not used, the latest version is used"
  echo "           if -s is used, sha256 file will not be downloaded"
  exit 1
}

while getopts "r:a:sd:v:" OPTS; do
  case ${OPTS} in
    r) REPO=${OPTARG} ;;
    a) ASSET=${OPTARG} ;;
    s) NOSUM=yes ;;
    d) DEST=${OPTARG} ;;
    v) VER=${OPTARG} ;;
    *) usage ;;
  esac
done

[ -z "$REPO" ] && echo "Need a repo to download from in username/repo format (-r)" && usage
[ -z "$ASSET" ] && echo "Need an asset name to download (-a)" && usage
[ -z "$DEST" ] && DEST="$(pwd)"

echo "Fetching $VER version of $ASSET from $REPO"

if [ -z "$VER" ]; then
  wget "https://github.com/$REPO/releases/latest/download/$ASSET"

  if [ -z "$NOSUM" ]; then
    wget "https://github.com/$REPO/releases/latest/download/$ASSET.sha256"
    sha256sum -c "$ASSET.sha256"
  fi
else
  wget "https://github.com/$REPO/releases/download/$VER/$ASSET"

  if [ -z "$NOSUM" ]; then
    wget "https://github.com/$REPO/releases/download/$VER/$ASSET.sha256"
    sha256sum -c "$ASSET.sha256"
  fi
fi

if [ ! -d "$DEST" ]; then
  mkdir -p "$DEST"
  cp "$ASSET" "$DEST"
fi
