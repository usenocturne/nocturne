{
  pkgs ? import <nixpkgs> {
    #crossSystem = {
    #  #config = "aarch64-unknown-linux-gnu";
    #  system = "aarch64-linux";
    #};
  }
}:

pkgs.mkShell {
  packages = [ pkgs.just pkgs.git ];
  #nativeBuildInputs = [ pkgs.just ];
}
