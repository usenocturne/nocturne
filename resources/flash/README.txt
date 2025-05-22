# Nocturne Installer

Disclaimer: Bricking the Car Thing is nearly impossible, but the risk is always there when flashing custom partition tables.

libusb is required on macOS (get brew from https://brew.sh if you don't have it and follow all instructions): "brew install libusb"

Car Thing driver from Terbium is required on Windows: run "irm https://driver.terbium.app/get | iex" in Powershell.

Make sure your Car Thing is unplugged, start holding 1+4 (buttons at the top), plug in your Car Thing's USB while still holding them, then let go after a couple seconds.

Use "sudo ./flash.sh" (Linux/macOS) or double click "flash.bat" (Windows) to flash Nocturne to your Car Thing.

Flashing will likely take about 10-30 minutes depending on your USB ports and some other factors. It’ll look like it’s going fast but then will flash other stuff after. Please try multiple ports if one isn’t working (Rear IO USB 3 and 2, BIOS flash port if on AMD, etc).

---

# To Uninstall:

Use a tool of your choice to flash stock or a different firmware.

If it's failing, use:
Windows: .\flashthing-cli.exe --unbrick
Linux/macOS: sudo ./flashthing-cli --unbrick

---

https://github.com/usenocturne/nocturne-image
https://discord.gg/mnURjt3M6m
