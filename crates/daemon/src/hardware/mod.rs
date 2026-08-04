//! Hardware device drivers (display backlight, image cache).

pub mod brightness;
pub mod image_cache;

pub use brightness::{
    get_brightness_config, get_display_config, init_brightness, is_display_sleeping,
    set_auto_brightness, set_brightness, sleep_display, start_ambient_light_task, wake_display,
};
pub use image_cache::ImageCache;
