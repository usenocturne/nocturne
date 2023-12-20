# Reference

These are the scripts and resources that I used to create the final debian image for the device, as well as some steps along the way.

Noteworthy scripts:

* `scripts/` all the scripts that ended up in `/scripts/` on the data partition
  * pretty much all the magic for configuring superbird hardware lives here
* `install_debian.sh` - using debootstrap, install debian onto a partition, or in a file (an image of the partition to be written later). this is how `data.ext4` was created in the final image
  * note that this script contains all the systemd service files and script content embedded as heredocs, to try to keep the script standalone.
* `install_debootstrap.sh`, `debootstrap-superbird.tar.gz`, and `tools/` - superbird stock os does not include debootstrap, you can install this version if you want. this is not necessary. I used this method to bootstrap debian on the data partition initially, but it was much faster to iterate with an image file on my desktop machine and then write it to the partition

Folders:

* `xorg/` two different versions of `xorg.conf`, for portrait and landscape. portait is used in the final image
* `systemd/` all the systemd service files used in the final image
* `etc/` I modified the stock versions of `/etc/fstab` and `/etc/inittab` to no longer use the data partition, so I could repurpose it for debian
* `env/` some different env examples. `env_switchable.txt` is what I used in the final image


