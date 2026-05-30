//! Hardware device drivers (display backlight, MFi coprocessor, image cache).

pub mod brightness;
pub mod image_cache;
pub mod mfi_chip;

pub use brightness::{
    get_brightness_config, init_brightness, set_auto_brightness, set_brightness,
    start_ambient_light_task,
};
pub use image_cache::ImageCache;
pub use mfi_chip::MfiChip;
