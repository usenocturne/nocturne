use crate::error::Result;
use std::{
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::SystemTime,
};
use tokio::fs;
use tracing::{debug, info, warn};

const CACHE_DIR: &str = "/var/cache/nocturned/images";
// Roughly 500 base64 album covers; shares the data partition with OTA downloads.
const MAX_CACHE_BYTES: u64 = 64 * 1024 * 1024;

pub struct ImageCache {
    cache_dir: PathBuf,
    max_bytes: u64,
    size_bytes: AtomicU64,
}

impl ImageCache {
    pub fn with_dir(cache_dir: PathBuf) -> Self {
        Self {
            cache_dir,
            max_bytes: MAX_CACHE_BYTES,
            size_bytes: AtomicU64::new(0),
        }
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
                return Ok(Self::with_dir(fallback));
            }
        }

        let cache = Self::with_dir(cache_dir);
        cache.trim().await;
        Ok(cache)
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
            Ok(base64_data) if base64_data.is_empty() => {
                warn!("Discarding empty cached image for {}", url);
                if let Err(e) = fs::remove_file(&cache_path).await {
                    warn!("Failed to remove empty cached image for {}: {}", url, e);
                }
                None
            }
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
        if data.is_empty() {
            warn!("Refusing to cache empty image for {}", url);
            return Ok(());
        }

        let cache_path = self.get_cache_path(url);
        let mut partial_path = cache_path.clone().into_os_string();
        partial_path.push(".partial");

        let replaced = fs::metadata(&cache_path).await.map_or(0, |meta| meta.len());

        // Write then rename so an interrupted write never leaves a truncated entry.
        fs::write(&partial_path, &data).await?;
        fs::rename(&partial_path, &cache_path).await?;

        debug!("Cached image for URL: {} at {:?}", url, cache_path);
        let size = self
            .size_bytes
            .load(Ordering::Relaxed)
            .saturating_sub(replaced)
            .saturating_add(data.len() as u64);
        self.size_bytes.store(size, Ordering::Relaxed);
        if size > self.max_bytes {
            self.trim().await;
        }
        Ok(())
    }

    /// Recounts the cache and evicts the oldest entries until it is back under
    /// three quarters of its budget, so a full cache does not trim on every put.
    async fn trim(&self) {
        let mut entries = match fs::read_dir(&self.cache_dir).await {
            Ok(entries) => entries,
            Err(err) => {
                warn!(%err, dir = %self.cache_dir.display(), "failed to read image cache");
                return;
            }
        };

        let mut files = Vec::new();
        let mut total = 0u64;
        loop {
            let entry = match entries.next_entry().await {
                Ok(Some(entry)) => entry,
                Ok(None) => break,
                Err(err) => {
                    warn!(%err, dir = %self.cache_dir.display(), "failed to list image cache");
                    break;
                }
            };
            let path = entry.path();
            let Ok(meta) = entry.metadata().await else {
                continue;
            };
            if !meta.is_file() {
                continue;
            }
            if path.extension().is_some_and(|ext| ext == "partial") {
                if let Err(err) = fs::remove_file(&path).await {
                    warn!(%err, path = %path.display(), "failed to remove partial cached image");
                }
                continue;
            }
            total += meta.len();
            files.push((
                meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                meta.len(),
                path,
            ));
        }

        let target = self.max_bytes / 4 * 3;
        if total > self.max_bytes {
            files.sort_unstable_by_key(|(modified, ..)| *modified);
            let before = total;
            for (_, len, path) in &files {
                if total <= target {
                    break;
                }
                match fs::remove_file(path).await {
                    Ok(()) => total -= len,
                    Err(err) => warn!(%err, path = %path.display(), "failed to evict cached image"),
                }
            }
            info!(before, after = total, "trimmed image cache");
        }
        self.size_bytes.store(total, Ordering::Relaxed);
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

    #[tokio::test]
    async fn empty_artwork_is_never_served_or_stored() {
        let root = tempfile::tempdir().unwrap();
        let cache = ImageCache::with_dir(root.path().to_path_buf());
        let url = "https://i.scdn.co/image/artwork";
        let path = root.path().join("artwork");

        fs::write(&path, "").await.unwrap();
        assert!(cache.get(url).await.is_none());
        assert!(!path.exists());

        cache.put(url, String::new()).await.unwrap();
        assert!(!path.exists());

        cache.put(url, "artwork".into()).await.unwrap();
        assert_eq!(cache.get(url).await.as_deref(), Some("artwork"));
        assert!(!root.path().join("artwork.partial").exists());
    }

    #[tokio::test]
    async fn evicts_oldest_entries_when_over_budget() {
        let root = tempfile::tempdir().unwrap();
        let cache = ImageCache {
            max_bytes: 40,
            ..ImageCache::with_dir(root.path().to_path_buf())
        };
        let base = SystemTime::now() - std::time::Duration::from_secs(60);
        for (index, name) in ["a", "b", "c"].into_iter().enumerate() {
            let path = root.path().join(name);
            fs::write(&path, "x".repeat(10)).await.unwrap();
            let file = std::fs::File::options().write(true).open(&path).unwrap();
            file.set_modified(base + std::time::Duration::from_secs(index as u64))
                .unwrap();
        }
        fs::write(root.path().join("stale.partial"), "x")
            .await
            .unwrap();
        cache.trim().await;

        cache
            .put("https://i.scdn.co/image/d", "x".repeat(20))
            .await
            .unwrap();

        assert!(!root.path().join("a").exists());
        assert!(!root.path().join("b").exists());
        assert!(root.path().join("c").exists());
        assert!(root.path().join("d").exists());
        assert!(!root.path().join("stale.partial").exists());
        assert_eq!(cache.size_bytes.load(Ordering::Relaxed), 30);
    }
}
