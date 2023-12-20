# Tools

## fake_debootstrap.sh

Tool used to create [debootstrap-superbird.tar.gz](../packages/debootstrap-superbird.tar.gz)

You can use `fake_debootstrap.sh` to fetch a package from debian repo, and its dependencies, and extract everything, then package it up into a `.tar.gz`

```bash
./fake_debootstrap.sh output.tar.gz bash wget htop
```
Will fetch all packages for `bash` `wget` and `htop`, and their dependencies, and prepare `output.tar.gz`

You can copy it to the device and extract it like so:
```bash
adb push output.tar.gz /tmp/
adb shell tar xf /tmp/output.tar.gz -C /
```

