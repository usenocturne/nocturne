{
  inputs,
  config,
  ...
}: {
  imports = [
    inputs.nocturned.nixosModules.default
    inputs.nocturne-ui.nixosModules.default
  ];

  services = {
    nocturne-ui = {
      enable = !config.nocturne.dev;
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
