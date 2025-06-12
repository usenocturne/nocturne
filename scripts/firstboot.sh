# shellcheck disable=SC2148
PATH=/usr/bin:/usr/sbin

get_opt() {
  echo "$@" | cut -d "=" -f 2
}

firstboot=0

# shellcheck disable=SC2013
# shellcheck disable=SC1001
for i in $(cat /proc/cmdline); do
  case $i in
    nocturne.firstboot\=*)
      firstboot=$(get_opt "$i")
      ;;
  esac
done

if [ "${firstboot}" -eq 1 ]; then
  /sbin/reset-data
  /sbin/reset-settings
  /usr/bin/uenv set firstboot 0
fi
