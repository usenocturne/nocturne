{
  description = "Nocturne NixOS image";

  inputs = {
    #nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    nixos-superbird.url = "github:joeyeamigh/nixos-superbird";
    nixpkgs.follows = "nixos-superbird/nixpkgs";

    deploy-rs.url = "github:serokell/deploy-rs";

    nocturned.url = "github:usenocturne/nocturned";
    nocturne-ui.url = "github:usenocturne/nocturne-ui";
  };

  outputs = inputs@{ self, nixpkgs, nixos-superbird, deploy-rs, ... }:
    let
      inherit (nixpkgs.lib) nixosSystem;
    in
    {
      nixosConfigurations = {
        superbird = nixosSystem {
          system = "aarch64-linux";
          specialArgs = {
            inherit self;
            inherit inputs;
          };
          modules = [
            nixos-superbird.nixosModules.superbird
            ./modules/default.nix
          ];
        };

        superbird-dev = nixosSystem {
          system = "aarch64-linux";
          specialArgs = {
            inherit self;
            inherit inputs;
          };
          modules = [
            nixos-superbird.nixosModules.superbird
            ./modules/default.nix
            ({ ... }: {
              nocturne = {
                dev = true;
                
                # Change this to point to your nocturne-ui development server
                url = "https://172.16.42.1:3000";
              };
            })
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
          };
        };
      };
    };
}
