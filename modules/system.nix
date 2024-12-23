{
  ...
}: {
  superbird = {
    swap = {
      enable = true;
      size = 512;
    };
  };

  nixpkgs.overlays = [
    (self: super: {
      cage = super.cage.overrideAttrs (old: {
        patches = (old.patches or []) ++ [
          ../patches/cage/0001-Command-line-option-to-hide-cursor.patch
        ];
      });
    })
  ];
}
