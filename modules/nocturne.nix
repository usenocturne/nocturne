{
  pkgs,
  inputs,
  ...
}: {
  imports = [
    inputs.nocturne-ui.nixosModules.default
    inputs.nocturned.nixosModules.default
  ];

  services = {
    nocturne-ui = {
      enable = true;
      port = 3500;
    };
    nocturned = {
      enable = true;
      port = 5000;
    };
  };

  environment.etc."nocturne/version.txt" = {
    text = "3.0.0";
    mode = "0644";
  };
}
