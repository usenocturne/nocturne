#!/bin/sh

echo "Checking for modules in /etc/modules /etc/modules-load.d /usr/lib/modules-load.d"

find-mods "$ROOTFS_PATH"/etc/modules
find "$ROOTFS_PATH"/etc/modules-load.d -name '*.conf' -exec find-mods {} \;
find "$ROOTFS_PATH"/usr/lib/modules-load.d -name '*.conf' -exec find-mods {} \;
if [ -f /tmp/modules.save ]; then
  LOAD_MODS="$(cat /tmp/modules.save)"
  rm /tmp/modules.save
fi

if [ "$DEFAULT_KERNEL_MODULES" != "*" ]; then
  cd "$ROOTFS_PATH"/lib/modules || exit 1

  # concatenate MODULE variables and remove excess spaces and new lines
  FIND_MODS="$(echo "${DEFAULT_KERNEL_MODULES} ${ADDITIONAL_KERNEL_MODULES} ${LOAD_MODS}" | xargs)"
  # loop all kernel versions
  for d in *; do
    echo "Saving from $d"

    # copy required modules to tmp dir
    mkdir "$d"_tmp
    cd "$d" || exit 1
    cp modules.* ../"$d"_tmp
    for m in ${FIND_MODS}; do
      colour_echo "finding: $m" -Cyan
      find ./ -type f -name "${m}.ko*" -fprint0 /tmp/found -exec find-deps {} \;
      [ ! -s /tmp/found ] && colour_echo "  ERR: no module found" -Red
    done
    if [ -n "${ADDITIONAL_DIR_KERNEL_MODULES}" ]; then
      colour_echo "searching for directories: ${ADDITIONAL_DIR_KERNEL_MODULES}" -Cyan
      for m in ${ADDITIONAL_DIR_KERNEL_MODULES}; do
        colour_echo "finding dir: ${m}" -Cyan
        find ./ -type d -fprint0 /tmp/found -name "${m}" -exec find {} -print0 -type f -name "*.ko*" \; | xargs -0 -I_mod find-deps _mod
        [ ! -s /tmp/found ] && colour_echo "  ERR: dir not found" -Red
      done
    fi
    colour_echo "Selected modules:" -Yellow
    SAVED_MODS="$(xargs -a /tmp/modules.save | tr -s ' ' '\n' | sort -u | xargs)"
    for m in ${SAVED_MODS}; do
      colour_echo "  > ${m}" -Blue
      cp --parents "${m}" ../"$d"_tmp
    done
    rm -f /tmp/modules.save /tmp/found
    cd .. || exit 1

    # replace original modules dir with new one
    rm -rf "$d"
    mv "$d"_tmp "$d"
  done

  cd "$WORK_PATH" || exit 1
else
  echo "skipped -> keep all modules"
fi
