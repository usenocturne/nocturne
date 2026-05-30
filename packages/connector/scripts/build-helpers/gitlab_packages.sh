#!/bin/sh
set -e

usage() {
  echo
  echo "Usage: gitlab_packages -p PROJECT -a ARTIFACT [-l] [-d DESTINATION -v VERSION -e EXTENSION]"
  echo "           if -d is not used the current working directory is used"
  echo "           if -v is not used the latest version is used"
  echo "           -l returns the latest version"
  echo "           a ARTIFACT.sha256 file is downloaded as well and the artifact is not extracted if it does not match"
  echo "           the version is appended to the artifact name before downloading, along with extension which defaults to \"tar.bz2\" if not set"
  exit 1
}

get_info() {
  curl -s -o - https://gitlab.com/api/v4/projects/"$1"/packages | xargs | tr ',' '\n'
}

get_proj_name() {
  get_info "$1" | grep name | head -n1 | cut -d':' -f2
}

latest_pkg() {
  get_info "$1" | grep version | sed "s/v.*n.//" | sort | tail -n1
}

while getopts "p:a:d:v:e:l" OPTS; do
  case ${OPTS} in
    p) PROJ=${OPTARG} ;;
    a) ARTI=${OPTARG} ;;
    d) DEST=${OPTARG} ;;
    v) VER=${OPTARG} ;;
    e) EXT=${OPTARG} ;;
    l) LATEST="TRUE" ;;
    *) usage ;;
  esac
done

[ -z "$PROJ" ] && echo "Need a project ID to download from (-p)" && usage
[ -z "$VER" ] && VER="$(latest_pkg "$PROJ")"
[ -n "$LATEST" ] && echo "$VER" && exit
[ -z "$ARTI" ] && echo "Need an artifact name to download (-a))" && usage
[ -z "$DEST" ] && DEST="$(pwd)"
[ -z "$EXT" ] && EXT="tar.bz2"

NAME=$(get_proj_name "$PROJ")
N="$ARTI-$VER.$EXT"
FN="$NAME/$VER/$N"

echo "Fetching version: $VER, with name $FN"
wget "https://gitlab.com/api/v4/projects/$PROJ/packages/generic/$FN"
wget "https://gitlab.com/api/v4/projects/$PROJ/packages/generic/$FN.sha256"

sha256sum -c "$N.sha256"

[ ! -d "$DEST" ] && mkdir -p "$DEST"
tar -xvjf "$N" -C "$DEST"
