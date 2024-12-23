{
  lib,
  ...
}: {
  imports = [
    ./bluetooth.nix
    ./display.nix
    ./nocturne.nix
    ./system.nix
  ];

  options.nocturne = {
    dev = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Enable development mode";
    };
    url = lib.mkOption {
      type = lib.types.str;
      default = "https://127.0.0.1:3500";
      description = "URL to open in browser";
    };
  };

  config = {
    system.stateVersion = "24.11";
  };
}
