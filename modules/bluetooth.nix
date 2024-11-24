{
  pkgs,
  ...
}: {
  environment.systemPackages = with pkgs; [
    bluez
    bluez-tools
  ];

  superbird.bluetooth = {
    enable = true;
    name = "Nocturne";
  };

  hardware.bluetooth.settings = {
    General = {
      DiscoverableTimeout = 0;
      PairableTimeout = 0;
    };
  };
}
