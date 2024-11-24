{
  pkgs,
  lib,
  ...
}: {
  imports = [
    ./bluetooth.nix
    ./display.nix
    ./nocturne.nix
  ];

  programs.chromium = {
    enable = true;
    extraOpts = {
      "BlockThirdPartyCookies" = false;
    };
  };

  superbird = {
    swap = {
      enable = true;
      size = 512;
    };
  };

  system.stateVersion = "24.11";
}
