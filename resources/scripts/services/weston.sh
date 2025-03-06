#!/sbin/openrc-run

# TODO: make this run as nocturne user

name="Weston"
supervisor="supervise-daemon"
command="/usr/bin/weston"
command_args="--continue-without-input --config=/etc/weston/weston.ini -- chromium --no-gpu --disable-gpu --disable-gpu-compositing --ozone-platform-hint=auto --ozone-platform=wayland --enable-wayland-ime --no-sandbox --autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream --use-fake-device-for-media-stream --disable-sync --force-device-scale-factor=1.0 --pull-to-refresh=0 --noerrdialogs --no-first-run --disable-infobars --fast --fast-start --disable-pinch --disable-translate --overscroll-history-navigation=0 --hide-scrollbars --disable-overlay-scrollbar --disable-features=OverlayScrollbar --disable-features=TranslateUI --disable-features=TouchpadOverscrollHistoryNavigation,OverscrollHistoryNavigation --force-dark-mode --password-store=basic --touch-events=enabled --ignore-certificate-errors --disk-cache-dir=/data/etc/chrome/cache --user-data-dir=/data/etc/chrome/data --kiosk --app=https://10.13.0.102:3000"
# command_user="nocturne"

depend() {
    need localmount
    after bootmisc modules
    provide display-manager
}

start_pre() {
    # if [ ! -d /run/user/$(id -u ${command_user}) ]; then
    #     mkdir -p /run/user/$(id -u ${command_user})
    #     chown ${command_user}:${command_user} /run/user/$(id -u ${command_user})
    #     chmod 0700 /run/user/$(id -u ${command_user})
    # fi
    # export XDG_RUNTIME_DIR=/run/user/$(id -u ${command_user})
    export XDG_RUNTIME_DIR=/data/tmp/0-runtime-dir
}
