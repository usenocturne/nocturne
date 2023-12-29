# Change Log

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