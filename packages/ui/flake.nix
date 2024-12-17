{
  description = "Nocturne UI";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    let
      overlay = final: prev: {
        nocturne-ui = self.packages.${prev.system}.default;
      };
    in
    {
      nixosModules.default = { config, lib, pkgs, ... }:
        let
          cfg = config.services.nocturne-ui;
        in
        {
          options.services.nocturne-ui = {
            enable = lib.mkEnableOption "Nocturne UI service";

            port = lib.mkOption {
              type = lib.types.port;
              default = 3500;
              description = "Port to listen on";
            };
          };

          config = lib.mkIf cfg.enable {
            nixpkgs.overlays = [ overlay ];

            security.pki.certificateFiles = [ "${pkgs.nocturne-ui}/share/nocturne/rootCA.pem" ];

            systemd.services.nocturne-ui = {
              description = "Nocturne UI service";
              wantedBy = [ "multi-user.target" ];

              serviceConfig = {
                ExecStart = "${pkgs.nocturne-ui}/bin/nocturne";
                Environment = [ "PORT=${toString cfg.port}" ];

                User = "superbird";
                Group = "users";

                Restart = "always";
              };
            };
          };
        };
    } //
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        nodeDeps = with pkgs; [
          nodejs_20
          bun
        ];
      in
      {
        packages.default = pkgs.stdenv.mkDerivation {
          pname = "nocturne-ui";
          version = "3.0.0-beta.1";
          src = ./.;

          nativeBuildInputs = nodeDeps ++ [ pkgs.cacert pkgs.mkcert ];

          buildPhase = ''
            runHook preBuild

            bun install
            bun run build

            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall

            mkdir -p $out/share/nocturne/.next

            cp -r .next/standalone/. $out/share/nocturne/
            cp -r .next/static $out/share/nocturne/.next
            cp -r public $out/share/nocturne
            cp prodserver.js $out/share/nocturne/

            export CAROOT="$out/share/nocturne"
            mkcert localhost 127.0.0.1 ::1
            mv localhost+2.pem $out/share/nocturne/cert.crt
            mv localhost+2-key.pem $out/share/nocturne/cert.key

            mkdir -p $out/bin
            cat > $out/bin/nocturne << EOF
            #!/bin/sh
            exec ${pkgs.nodejs_20}/bin/node $out/share/nocturne/prodserver.js
            EOF
            chmod +x $out/bin/nocturne

            runHook postInstall
          '';
        };

        devShells.default = pkgs.mkShell {
          buildInputs = nodeDeps ++ (with pkgs; [
            mkcert
            openssl
          ]);

          shellHook = ''
            echo "Node $(node --version)"
            echo "bun $(bun --version)"

            if [ ! -f "cert.crt" ]; then
              echo "Setting up local SSL certificates..."
              mkcert -install
              mkcert localhost 127.0.0.1 ::1
              mv localhost+2.pem cert.crt
              mv localhost+2-key.pem cert.key
            fi
          '';
        };
      }
    );
}