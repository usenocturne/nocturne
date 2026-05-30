<h1 align="center">
  <img src="https://usenocturne.com/images/logo.png" alt="Nocturne" width="200">
  <br>
  nocturned
  <br>
</h1>

<p align="center">Local daemon for real-time web/host communication</p>

<p align="center">
  <a href="#building">Building</a> •
  <a href="#credits">Credits</a> •
  <a href="#donate">Donate</a> •
  <a href="#related">Related</a> •
  <a href="#license">License</a>
</p>

## Building

Use the `Justfile`. `just build` will cross-compile a Linux arm64 release binary. Cross-compilation is driven by [`cross`](https://github.com/cross-rs/cross), so a working Docker runtime is required.

```
$ just -l
Available recipes:
    build
    codegen *args
    codegen-check
    codegen-mirror
    codegen-snapshot-review
    copy
    fmt-check
    lint
    lint-check
    test
    test-emulator~
```

## Donate

Nocturne is a massive endeavor, and the team has spent every day over the last year making it a reality out of our passion for creating something that people like you love to use.

All donations are split between the three members of the Nocturne team and go towards the development of future features. We are so grateful for your support!

[Donation Page](https://usenocturne.com/donate)

## Related

- [nocturne](https://github.com/usenocturne/nocturne)
- [nocturne-ui](https://github.com/usenocturne/nocturne-ui) - Nocturne's standalone web application written with Vite + React

## Credits

This software was made possible only through the following individuals:

- [Dominic Frye](https://github.com/itsnebulalol)
- [Neel Patel](https://github.com/68p)

We'd like to give a huge thanks to [Joey Eamigh](https://github.com/JoeyEamigh) for [bridgething](https://github.com/JoeyEamigh/bridgething) (protocol, more robust iAP2, OTA, and more), [yocto-superbird](https://github.com/JoeyEamigh/yocto-superbird), and for a ton of help during the Yocto migration. We'd also like to thank [lmore377](https://github.com/lmore377) for modernizing the Car Thing's tooling and contributions to bridgething/yocto-superbird. The new Nocturne OS image powered by Yocto and modern software wouldn't be possible without them.

## License

This project is licensed under the **GPL-3.0** license.

We kindly ask that any modifications or distributions made outside of direct forks from this repository include attribution to the original project in the README, as we have worked hard on this. :)

---

> © 2026 Vanta Labs.

> "Spotify" and "Car Thing" are trademarks of Spotify AB. This software is not affiliated with or endorsed by Spotify AB.

> [usenocturne.com](https://usenocturne.com) &nbsp;&middot;&nbsp;
> [GitHub](https://github.com/usenocturne) &nbsp;&middot;&nbsp;
> [Discord](https://discord.gg/mnURjt3M6m)

