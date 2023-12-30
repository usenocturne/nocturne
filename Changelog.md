# Change Log

v1.5
* moved chromium settings into separate file `/scripts/chromium_settings.sh`
* added buttons service, configure in `/scripts/buttons_settings.py`
  * need to provide your Home Assistant url, and long-lived token
  * control a light entity brightness by turning knob, pressing toggles on/off
  * recall scene/automation/script using buttons along edge, and button next to knob
* ditched the heredoc'd files in `install_debian.sh`, reorganized files needed for it
* added `update_local.sh` which can update an already-running local device running a previous release

Starting with this release, your settings are stored in `/scripts/chromium_settings.sh` and `/scripts/buttons_settings.py`, and those two files will NOT be touched during subsequent upgrades using `update_local.sh`, so your settings will survive upgrades.
However, your existing settings will NOT be migrated, so if you use `update_local.sh` to upgrade an existing device you will then need to edit those two files.

If you are coming from v1.2 you should flash the image from Releases instead, you will end up with much more free space.

v1.4
* added back some python packages for fun
* added `--local_proxy` flag to `install_debian.sh`, to use a local instance of apt-cacher-ng
* added some helper scripts for creating an image for release
* switch to main debian mirror, `http://deb.debian.org/debian/`
* use x11vnc `-loop` flag instead of our own loop
* remove ~10px black border around chromium (more pixels!)
* hide scrollbars in chromium
* chromium service (including X11) now logs to `/var/log/chromium.log`

v1.3
* hide cursor in chromium
* add xorg.conf entries for buttons and knob
* fix issue with landscape touch input doubling
* remove a couple unnecessary packages to free up space
* fix incorrect kernel modules in /lib/modules
* remove unnecessary hardcoded chromium width and height
* remove unnecessary hardcoded vnc server width and height
* make vnc survive restart of X11
* clear display when chromium.service stops
  
v1.2
* initial release
