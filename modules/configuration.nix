{
  pkgs,
  ...
}: {
  imports = [
    ./nocturne.nix
  ];

  programs.chromium = {
    enable = true;
    extraOpts = {
      "CookiesAllowedForUrls" = [
        "[*.]spotify.com"
        "[*.]nocturne.brandons.place"
      ];
    };
  };

  services.cage.environment = {
    WLR_LIBINPUT_NO_DEVICES = "1";
  };

  superbird = {
    bluetooth = {
      enable = true;
      name = "Nocturne";
    };

    gui = {
      enable = true;
      app = ''
        ${pkgs.wayvnc}/bin/wayvnc & \
        ${pkgs.chromium}/bin/chromium \
          --ozone-platform-hint=auto \
          --ozone-platform=wayland \
          --no-sandbox \
          --autoplay-policy=no-user-gesture-required \
          --use-fake-ui-for-media-stream \
          --use-fake-device-for-media-stream \
          --disable-sync \
          --remote-debugging-port=9222 \
          --force-device-scale-factor=1.0 \
          --pull-to-refresh=0 \
          --disable-smooth-scrolling \
          --disable-login-animations \
          --disable-modal-animations \
          --noerrdialogs \
          --no-first-run \
          --disable-infobars \
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
          --app=https://nocturne.brandons.place
      '';
    };
  };

  system.stateVersion = "24.11";
}
