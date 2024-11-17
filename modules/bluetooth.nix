{
  pkgs,
  ...
}: {
  environment.systemPackages = with pkgs; [
    bluez
    bluez-tools
  ];

  hardware.bluetooth.settings = {
    General = {
      DiscoverableTimeout = 0;
      PairableTimeout = 0;
    };
  };
}
