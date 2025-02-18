{
  pkgs,
  config,
  ...
}: {
  programs.chromium = {
    enable = true;
    extraOpts = {
      "BlockThirdPartyCookies" = false;
    };
  };

  superbird.gui = {
    enable = true;
    app = ''
      ${pkgs.ungoogled-chromium}/bin/chromium \
        --no-gpu \
        --disable-gpu \
        --disable-gpu-compositing \
        --ozone-platform-hint=auto \
        --ozone-platform=wayland \
        --enable-wayland-ime \
        --no-sandbox \
        --autoplay-policy=no-user-gesture-required \
        --use-fake-ui-for-media-stream \
        --use-fake-device-for-media-stream \
        --disable-sync \
        --remote-debugging-address=172.16.42.2 \
        --remote-debugging-port=9222 \
        --force-device-scale-factor=1.0 \
        --pull-to-refresh=0 \
        --noerrdialogs \
        --no-first-run \
        --disable-infobars \
        --fast \
        --fast-start \
        --disable-pinch \
        --disable-translate \
        --overscroll-history-navigation=0 \
        --hide-scrollbars \
        --disable-overlay-scrollbar \
        --disable-features=OverlayScrollbar \
        --disable-features=TranslateUI \
        --disable-features=TouchpadOverscrollHistoryNavigation,OverscrollHistoryNavigation \
        --password-store=basic \
        --touch-events=enabled \
        --ignore-certificate-errors \
        --kiosk \
        --app=${config.nocturne.url}
    '';
  };

  #services.cage = {
  #  extraArguments = [ "-c" ];
  #  environment = {
  #    WLR_LIBINPUT_NO_DEVICES = "1";
  #  };
  #};

  #services.udev.extraRules = ''
    # GPIO Keys (event0)
  #  KERNEL=="event0", SUBSYSTEM=="input", GROUP="input", MODE="0660", ENV{ID_INPUT_KEYBOARD}="1", ENV{LIBINPUT_DEVICE_GROUP}="gpio-keys"

    # Rotary Dial (event1)
  #  KERNEL=="event1", SUBSYSTEM=="input", GROUP="input", MODE="0660", ENV{ID_INPUT_KEYBOARD}="1", ENV{LIBINPUT_DEVICE_GROUP}="rotary-input"

    # Touchscreen (event3)
  #  KERNEL=="event3", SUBSYSTEM=="input", GROUP="input", MODE="0660", ENV{ID_INPUT_TOUCHSCREEN}="1", ENV{LIBINPUT_DEVICE_GROUP}="touchscreen"
  #'';
}
