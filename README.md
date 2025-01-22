# nocturne-image, void edition

## Flashing

Know which directory has the disk images that you want to flash; if built using
instructions in the [Building section](#building), it will be `./out`. It should
have files such as `system_a` and `data` at the top level inside the dir.

## Building

Use the `./build.sh` script. We currently use the stock Car Thing kernel, so
you'll need a dump of the system partition on the stock OS, since it extracts
the kernel modules from there. The path to this dump is provided as the first
argument to the script.

For example, if you have your system_a dump under `source/system_a.ext2`, then
you would run:

```console
$ ./build.sh source/system_a.ext2
```

TODO: output files

## Updating

The Void Linux bootstrap tarball version is hardcoded in build.sh and needs to
be manually updated if needed.
