use crate::error::Result;
use std::path::PathBuf;
use tokio::fs;
use tracing::{debug, info, warn};

const CACHE_DIR: &str = "/var/cache/nocturned/images";

pub struct ImageCache {
    cache_dir: PathBuf,
}

impl ImageCache {
    pub fn with_dir(cache_dir: PathBuf) -> Self {
        Self { cache_dir }
    }

    pub async fn new() -> Result<Self> {
        let cache_dir = PathBuf::from(CACHE_DIR);

        if !cache_dir.exists() {
            info!("Creating image cache directory at {}", CACHE_DIR);
            if let Err(err) = fs::create_dir_all(&cache_dir).await {
                let fallback = PathBuf::from("/tmp/nocturned-image-cache");
                warn!(
                    %err,
                    fallback = %fallback.display(),
                    "failed to create {CACHE_DIR}; falling back to ephemeral tmpfs cache",
                );
                fs::create_dir_all(&fallback).await?;
                return Ok(Self {
                    cache_dir: fallback,
                });
            }
        }

        Ok(Self { cache_dir })
    }

    fn get_cache_path(&self, url: &str) -> PathBuf {
        let mut parts = url.rsplit('/');
        let last_part = parts.next().unwrap_or(url);
        let image_id = if url.contains("spotifycdn.com") && last_part.len() <= 3 {
            // Spotify's localized artwork URLs end in an image ID and a locale.
            parts.next().unwrap_or(last_part)
        } else {
            last_part
        };

        self.cache_dir.join(image_id)
    }

    pub async fn get(&self, url: &str) -> Option<String> {
        let cache_path = self.get_cache_path(url);

        match fs::read_to_string(&cache_path).await {
            Ok(base64_data) => {
                debug!("Cache hit for URL: {}", url);
                Some(base64_data)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                debug!("Cache miss for URL: {}", url);
                None
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reads_existing_cache_entries_and_replaces_artwork() {
        let root = tempfile::tempdir().unwrap();
        let cache = ImageCache::with_dir(root.path().to_path_buf());
        let urls = [
            "https://pickasso.spotifycdn.com/image/artwork/en",
            "https://pickasso.spotifycdn.com/image/artwork",
            "https://i.scdn.co/image/artwork",
        ];
        fs::write(root.path().join("artwork"), "original")
            .await
            .unwrap();
        for url in urls {
            assert_eq!(cache.get(url).await.as_deref(), Some("original"));
        }
        cache.put(urls[0], "replacement".into()).await.unwrap();
        assert_eq!(cache.get(urls[1]).await.as_deref(), Some("replacement"));
    }

    #[tokio::test]
    async fn missing_or_invalid_cached_artwork_is_a_miss() {
        let root = tempfile::tempdir().unwrap();
        let cache = ImageCache::with_dir(root.path().to_path_buf());
        let url = "https://i.scdn.co/image/artwork";
        assert!(cache.get(url).await.is_none());
        fs::write(root.path().join("artwork"), [0xff])
            .await
            .unwrap();
        assert!(cache.get(url).await.is_none());
        fs::remove_file(root.path().join("artwork")).await.unwrap();
        fs::create_dir(root.path().join("artwork")).await.unwrap();
        assert!(cache.get(url).await.is_none());
    }
}
