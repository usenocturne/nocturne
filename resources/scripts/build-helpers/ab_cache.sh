#!/bin/sh -e

usage() {
  echo
  echo "Usage: ab_cache [-c] -p PATH -s SCRIPT [-a ARGS]"
  echo "           -c run script in chroot"
  echo "           -p is path of directory or file to cache"
  echo "           -s is script/program to run if cache is missing"
  echo '           -a args to pass to script/program (use "" if more than one)'
  echo
  exit 1
}

SCRIPT=none
while getopts "s:a:p:c" OPTS; do
  case ${OPTS} in
    c) CHROOT="chroot" ;;
    p) CABPATH=${OPTARG} ;;
    s) SCRIPT=${OPTARG} ;;
    a) ARGS=${OPTARG} ;;
    *) usage ;;
  esac
done

if [ -z "$SCRIPT" ] || [ -z "$CABPATH" ]; then
  usage
fi
[ -z "${CACHE_PATH}" ] && echo "CACHE_PATH is not set, not saving archive"

_DIRNAME=$(dirname "$CABPATH")
_CNAME=$(basename "$CABPATH")
_ARCNAME=$(echo "$CABPATH" | tr '/*' '_')
_LOCAL_CACHE="${CACHE_PATH}/${ARCH}/$_ARCNAME.tar.gz"
_CHECKSUMS="${CACHE_PATH}/${ARCH}/checksums.cache"

if [ -n "${CACHE_PATH}" ]; then
  if echo "$SCRIPT" | grep -qE "^$INPUT_PATH|^$RES_PATH"; then
    colour_echo "Checking cache checksum for $SCRIPT" -Cyan
    _DO_CHECKSUM="yes"
    if [ -f "$_CHECKSUMS" ]; then
      grep "$SCRIPT" "$_CHECKSUMS" | sha3sum -c && UP2DATE="YES"
    fi
  else
    colour_echo "Not checking checksum for: $SCRIPT, not in $INPUT_PATH or $RES_PATH" -Cyan
    UP2DATE="YES"
  fi
fi

if [ -f "$_LOCAL_CACHE" ] && [ -n "$UP2DATE" ]; then
  colour_echo "Unpacking: $_LOCAL_CACHE" -Cyan
  mkdir -p "$_DIRNAME"
  tar -xf "$_LOCAL_CACHE" -I pigz -C "$_DIRNAME"
else
  # run script if result not cached
  if [ "$SCRIPT" != "none" ]; then
    colour_echo "  cache miss, running $SCRIPT" -Red
    if [ -n "$CHROOT" ]; then
      if [ -n "$_DO_CHECKSUM" ]; then
        eval chroot_exec -c "$SCRIPT" "$ARGS"
      else
        # just run command if not a script in /input or /resources
        eval chroot_exec "$SCRIPT" "$ARGS"
      fi
    else
      # run script outside of chroot if -c not passed
      eval "$SCRIPT" "$ARGS"
    fi
  fi

  if [ -n "${CACHE_PATH}" ]; then
    mkdir -p "$(dirname "$_LOCAL_CACHE")"
    colour_echo "  creating cache archive  $_LOCAL_CACHE" -Red
    (
      cd "$_DIRNAME"
      # use find to get names to allow for wildcards
      find ./ -maxdepth 1 -name "$_CNAME" -fprint /tmp/cache.list
      if [ ! -s /tmp/cache.list ]; then
        colour_echo "  ERR: $_DIRNAME/$_CNAME not found" -Red
        rm -f /tmp/cache.list
        exit 1
      fi
      tar -cf "$_LOCAL_CACHE" -I pigz -T /tmp/cache.list
      # store checksum if script is in INPUT or RES_PATH
      if [ -n "$_DO_CHECKSUM" ]; then
        touch "$_CHECKSUMS"
        _ESCSCRIPT="$(echo ${SCRIPT} | sed 's+\/+\\\/+g')"
        sed "/$_ESCSCRIPT/d" -i "$_CHECKSUMS"
        sha3sum "$SCRIPT" >>"$_CHECKSUMS"
      fi
      rm -f /tmp/cache.list
    )
  fi
fi
