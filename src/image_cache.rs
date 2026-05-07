use crate::error::Result;
use std::path::PathBuf;
use tokio::fs;
use tracing::{debug, error, info, warn};

const CACHE_DIR: &str = "/var/cache/nocturned/images";

pub struct ImageCache {
    cache_dir: PathBuf,
}

impl ImageCache {
    pub async fn new() -> Result<Self> {
        let cache_dir = PathBuf::from(CACHE_DIR);

        if !cache_dir.exists() {
            info!("Creating image cache directory at {}", CACHE_DIR);
            fs::create_dir_all(&cache_dir).await?;
        }

        Ok(Self { cache_dir })
    }

    fn get_cache_path(&self, url: &str) -> PathBuf {
        // For Spotify CDN URLs like:
        // https://pickasso.spotifycdn.com/image/ab67c0de0000deef/dt/v1/img/daily/1/ab6761610000e5eb523b45e1db5e220a25302aba/en
        // Extract the ID before /en (or other locale codes)

        let image_id = if url.contains("spotifycdn.com") {
            let parts: Vec<&str> = url.rsplit('/').collect();
            if parts.len() >= 2 {
                let last_part = parts[0];
                if last_part.len() <= 3 {
                    parts[1]
                } else {
                    last_part
                }
            } else {
                parts.first().unwrap_or(&url)
            }
        } else {
            url.rsplit('/').next().unwrap_or(url)
        };

        self.cache_dir.join(image_id)
    }

    pub async fn get(&self, url: &str) -> Option<String> {
        let cache_path = self.get_cache_path(url);

        if !cache_path.exists() {
            debug!("Cache miss for URL: {}", url);
            return None;
        }

        match fs::read_to_string(&cache_path).await {
            Ok(base64_data) => {
                debug!("Cache hit for URL: {}", url);
                Some(base64_data)
            }
            Err(e) => {
                warn!("Failed to read cached image for {}: {}", url, e);
                None
            }
        }
    }

    pub async fn put(&self, url: &str, data: String) -> Result<()> {
        let cache_path = self.get_cache_path(url);

        fs::write(&cache_path, &data).await?;

        debug!("Cached image for URL: {} at {:?}", url, cache_path);
        Ok(())
    }

    #[allow(dead_code)]
    pub async fn clear(&self) -> Result<()> {
        info!("Clearing image cache");

        let mut entries = fs::read_dir(&self.cache_dir).await?;
        let mut count = 0;

        while let Some(entry) = entries.next_entry().await? {
            if let Err(e) = fs::remove_file(entry.path()).await {
                error!("Failed to remove cache file {:?}: {}", entry.path(), e);
            } else {
                count += 1;
            }
        }

        info!("Cleared {} cached images", count);
        Ok(())
    }
}
