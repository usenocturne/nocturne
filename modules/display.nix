{
  pkgs,
  ...
}: {
  services.udev.extraRules = ''
    # GPIO Keys (event0)
    KERNEL=="event0", SUBSYSTEM=="input", GROUP="input", MODE="0660", ENV{ID_INPUT_KEYBOARD}="1", ENV{LIBINPUT_DEVICE_GROUP}="gpio-keys"
    
    # Rotary Dial (event1)
    KERNEL=="event1", SUBSYSTEM=="input", GROUP="input", MODE="0660", ENV{ID_INPUT_KEYBOARD}="1", ENV{LIBINPUT_DEVICE_GROUP}="rotary-input"
    
    # Touchscreen (event3)
    KERNEL=="event3", SUBSYSTEM=="input", GROUP="input", MODE="0660", ENV{ID_INPUT_TOUCHSCREEN}="1", ENV{LIBINPUT_DEVICE_GROUP}="touchscreen"
  '';
}
