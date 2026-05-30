#!/bin/sh
# A/B slot debug helper for mainline u-boot env.
#
# subcommands:
#   status              active + inactive slot, tries counters, want_boot, build id
#   active              "a" or "b"
#   inactive            the OTHER slot
#   set-slot <a|b>      fw_setenv slot_active=<slot>; debug aid only.
#                       OTA flips slot_active inside swupdate's bootenv block.

set -eu

usage() {
    grep '^#   ' "$0" | sed 's/^#   /  /'
    exit 2
}

slot_active() {
    fw_printenv -n slot_active 2>/dev/null || echo "a"
}

slot_inactive() {
    case "$(slot_active)" in
        a) echo "b" ;;
        b) echo "a" ;;
        *) echo "b" ;;
    esac
}

slot_tries() {
    case "$1" in
        a) fw_printenv -n slot_a_tries 2>/dev/null || echo "?" ;;
        b) fw_printenv -n slot_b_tries 2>/dev/null || echo "?" ;;
    esac
}

case "${1-}" in
    status)
        active="$(slot_active)"
        inactive="$(slot_inactive)"
        printf "active:    %s  (tries=%s)\n" "$active"   "$(slot_tries "$active")"
        printf "inactive:  %s  (tries=%s)\n" "$inactive" "$(slot_tries "$inactive")"
        printf "want_boot: %s\n" "$(fw_printenv -n want_boot 2>/dev/null || echo "?")"
        if [ -r /etc/superbird ]; then
            build_id=$(grep -o '"imageBuildId"[^,]*' /etc/superbird | sed 's/.*: *"\(.*\)".*/\1/')
            printf "build:     %s\n" "$build_id"
        fi
        ;;
    active)   slot_active ;;
    inactive) slot_inactive ;;
    set-slot)
        slot="${2-}"
        case "$slot" in
            a|b) fw_setenv slot_active "$slot" ;;
            *) echo "set-slot: expected a or b, got '$slot'" >&2; exit 2 ;;
        esac
        ;;
    -h|--help|help|"")
        usage
        ;;
    *)
        echo "unknown command: $1" >&2
        usage
        ;;
esac
