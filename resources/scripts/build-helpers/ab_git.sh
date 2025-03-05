#!/bin/sh

usage() {
  echo
  echo "Usage: ab_git -r REPO [-p PATH]"
  echo " -r download REPO (and cache if CACHE_PATH is set)"
  echo " -p is path of directory to save git into, if not set ${ROOTFS_PATH}/tmp/PROJECT_NAME is used"
  echo
  exit 1
}

while getopts "r:p:" OPTS; do
  case ${OPTS} in
    r) REPO=${OPTARG} ;;
    p) REPO_PATH=${OPTARG} ;;
    *) usage ;;
  esac
done

SNAME=$(basename "$REPO" | sed "s/.git//")
[ -z "$REPO_PATH" ] && REPO_PATH=${ROOTFS_PATH}/tmp/"$SNAME"

ab_cache -p "${REPO_PATH}" -s git -a "clone --depth 1 ${REPO} ${REPO_PATH}"
