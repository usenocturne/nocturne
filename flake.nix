{
  description = "Nocturne NixOS";
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    nixos-superbird.url = "github:joeyeamigh/nixos-superbird/9ba7d16b6a11c5fa987bb46e4992ab26f67d292f";
    deploy-rs.url = "github:serokell/deploy-rs";

    nocturned.url = "github:usenocturne/nocturned";
    #nocturne-ui.url = "github:usenocturne/nocturne-ui/standalone";
  };

  outputs = inputs@{ self, nixpkgs, nixos-superbird, deploy-rs, ... }:
    let
      inherit (nixpkgs.lib) nixosSystem;
    in
    {
      nixosConfigurations = {
        superbird = nixosSystem {
          system = "aarch64-linux";
          specialArgs = { inherit inputs; };
          modules = [
            nixos-superbird.nixosModules.superbird
            ./modules/default.nix
          ];
        };

        superbird-qemu = nixosSystem {
          system = "aarch64-linux";
          specialArgs = { inherit inputs; };
          modules = [
            nixos-superbird.nixosModules.superbird
            ./modules/default.nix
            (
              { ... }:
              {
                superbird.qemu = true;
              }
            )
          ];
        };
      };

      deploy.nodes = {
        superbird = {
          hostname = "172.16.42.2";
          fastConnection = false;
          remoteBuild = false;
          profiles.system = {
            sshUser = "root";
            path = deploy-rs.lib.aarch64-linux.activate.nixos self.nixosConfigurations.superbird;
            user = "root";
            sshOpts = [
              "-i"
              "${self.nixosConfigurations.superbird.config.system.build.ed25519Key}"
            ];
          };
        };
      };
    };
}
