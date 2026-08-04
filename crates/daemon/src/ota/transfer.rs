use std::{
    io,
    path::{Path, PathBuf},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::{
    fs::OpenOptions,
    io::{AsyncReadExt, AsyncWriteExt},
};
use tokio_util::sync::CancellationToken;

const META_FLUSH_INTERVAL_BYTES: u64 = 1024 * 1024;
const REAPER_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
const STALE_AFTER: Duration = Duration::from_secs(7 * 24 * 60 * 60);

#[derive(Debug, Clone)]
pub struct ChunkedTransfer {
    transfers_dir: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChunkOutcome {
    More(u64),
    Done,
}

#[derive(Debug, thiserror::Error)]
pub enum TransferError {
    #[error("transfer metadata does not match the requested artifact")]
    MetadataMismatch,
    #[error("chunk offset {got} != expected {expected}")]
    OffsetMismatch { expected: u64, got: u64 },
    #[error("sha256 mismatch: expected {expected}, got {got}")]
    HashMismatch { expected: String, got: String },
    #[error("size mismatch: expected {expected}, got {got}")]
    SizeMismatch { expected: u64, got: u64 },
    #[error("io error: {0}")]
    Io(#[from] io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TransferMeta {
    expected_size: u64,
    expected_sha256: String,
    received: u64,
}

impl ChunkedTransfer {
    pub fn new(transfers_dir: PathBuf) -> Self {
        Self { transfers_dir }
    }

    pub async fn begin(
        &self,
        update_id: &str,
        expected_size: u64,
        expected_sha256: &str,
    ) -> Result<u64, TransferError> {
        tokio::fs::create_dir_all(&self.transfers_dir).await?;

        let partial_path = self.path(update_id);
        let meta_path = self.meta_path(update_id);
        let partial_exists = tokio::fs::try_exists(&partial_path).await?;
        let meta_exists = tokio::fs::try_exists(&meta_path).await?;
        match (partial_exists, meta_exists) {
            (true, true) => {
                return self
                    .resume_offset(update_id, expected_size, expected_sha256)
                    .await;
            }
            (true, false) => remove_if_exists(partial_path.clone()).await?,
            (false, true) => remove_if_exists(meta_path.clone()).await?,
            (false, false) => {}
        }

        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&partial_path)
            .await?;
        let received = file.metadata().await?.len();

        let meta = TransferMeta {
            expected_size,
            expected_sha256: expected_sha256.to_string(),
            received,
        };
        write_meta_atomic(&meta_path, &meta).await?;
        Ok(received)
    }

    pub async fn resume_offset(
        &self,
        update_id: &str,
        expected_size: u64,
        expected_sha256: &str,
    ) -> Result<u64, TransferError> {
        let meta = load_meta(&self.meta_path(update_id)).await?;
        if meta.expected_size != expected_size
            || !meta.expected_sha256.eq_ignore_ascii_case(expected_sha256)
        {
            return Err(TransferError::MetadataMismatch);
        }

        let received = tokio::fs::metadata(self.path(update_id)).await?.len();
        if received > expected_size {
            return Err(TransferError::SizeMismatch {
                expected: expected_size,
                got: received,
            });
        }
        Ok(received)
    }

    pub async fn write_chunk(
        &self,
        update_id: &str,
        offset: u64,
        bytes: &[u8],
        last: bool,
    ) -> Result<ChunkOutcome, TransferError> {
        let meta_path = self.meta_path(update_id);
        let mut meta = load_meta(&meta_path).await?;
        let partial_path = self.path(update_id);
        let current_received = match tokio::fs::metadata(&partial_path).await {
            Ok(metadata) => metadata.len(),
            Err(err) if err.kind() == io::ErrorKind::NotFound => 0,
            Err(err) => return Err(err.into()),
        };

        if offset != current_received {
            return Err(TransferError::OffsetMismatch {
                expected: current_received,
                got: offset,
            });
        }

        let new_received = current_received + bytes.len() as u64;
        if new_received > meta.expected_size {
            return Err(TransferError::SizeMismatch {
                expected: meta.expected_size,
                got: new_received,
            });
        }

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&partial_path)
            .await?;
        file.write_all(bytes).await?;
        file.flush().await?;

        if should_flush_meta(meta.received, new_received) || last {
            meta.received = new_received;
            write_meta_atomic(&meta_path, &meta).await?;
        }

        if !last {
            return Ok(ChunkOutcome::More(new_received));
        }

        if new_received != meta.expected_size {
            return Err(TransferError::SizeMismatch {
                expected: meta.expected_size,
                got: new_received,
            });
        }

        let got = sha256_file(&partial_path).await?;
        if !got.eq_ignore_ascii_case(&meta.expected_sha256) {
            return Err(TransferError::HashMismatch {
                expected: meta.expected_sha256,
                got,
            });
        }

        Ok(ChunkOutcome::Done)
    }

    pub async fn abandon(&self, update_id: &str) -> Result<(), TransferError> {
        remove_if_exists(self.path(update_id)).await?;
        remove_if_exists(self.meta_path(update_id)).await?;
        Ok(())
    }

    pub fn path(&self, update_id: &str) -> PathBuf {
        self.transfers_dir.join(format!("{update_id}.partial"))
    }

    pub fn meta_path(&self, update_id: &str) -> PathBuf {
        self.transfers_dir.join(format!("{update_id}.meta"))
    }
}

pub fn spawn_reaper(
    transfers_dir: PathBuf,
    cancel: CancellationToken,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        sweep_stale(&transfers_dir).await;

        let mut interval = tokio::time::interval(REAPER_INTERVAL);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                _ = cancel.cancelled() => return,
                _ = interval.tick() => sweep_stale(&transfers_dir).await,
            }
        }
    })
}

fn should_flush_meta(previous: u64, current: u64) -> bool {
    previous / META_FLUSH_INTERVAL_BYTES != current / META_FLUSH_INTERVAL_BYTES
}

async fn load_meta(path: &Path) -> Result<TransferMeta, TransferError> {
    let bytes = tokio::fs::read(path).await?;
    Ok(serde_json::from_slice(&bytes)?)
}

async fn write_meta_atomic(path: &Path, meta: &TransferMeta) -> Result<(), TransferError> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "meta path has no parent"))?;
    tokio::fs::create_dir_all(parent).await?;
    let parent = parent.to_path_buf();
    let path = path.to_path_buf();
    let bytes = serde_json::to_vec(meta)?;

    tokio::task::spawn_blocking(move || -> Result<(), TransferError> {
        let mut tmp = tempfile::NamedTempFile::new_in(parent)?;
        std::io::Write::write_all(&mut tmp, &bytes)?;
        std::io::Write::flush(&mut tmp)?;
        tmp.persist(path)
            .map_err(|err| TransferError::Io(err.error))?;
        Ok(())
    })
    .await
    .map_err(io::Error::other)??;

    Ok(())
}

async fn sha256_file(path: &Path) -> Result<String, TransferError> {
    let mut file = tokio::fs::File::open(path).await?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];

    loop {
        let n = file.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

async fn remove_if_exists(path: PathBuf) -> Result<(), TransferError> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.into()),
    }
}

async fn sweep_stale(transfers_dir: &Path) {
    let mut entries = match tokio::fs::read_dir(transfers_dir).await {
        Ok(entries) => entries,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return,
        Err(err) => {
            tracing::warn!(?err, dir = %transfers_dir.display(), "failed to read OTA transfers dir");
            return;
        }
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        let meta_path = entry.path();
        if meta_path.extension().and_then(|ext| ext.to_str()) != Some("meta") {
            continue;
        }

        let is_stale = match entry
            .metadata()
            .await
            .and_then(|metadata| metadata.modified())
        {
            Ok(modified) => modified
                .elapsed()
                .map(|elapsed| elapsed > STALE_AFTER)
                .unwrap_or(true),
            Err(err) => {
                tracing::warn!(?err, path = %meta_path.display(), "failed to inspect OTA transfer meta");
                true
            }
        };

        if !is_stale {
            continue;
        }

        if let Some(stem) = meta_path.file_stem().and_then(|stem| stem.to_str()) {
            let partial_path = transfers_dir.join(format!("{stem}.partial"));
            if let Err(err) = remove_if_exists(partial_path).await {
                tracing::warn!(?err, update_id = stem, "failed to remove stale OTA partial");
            }
        }
        if let Err(err) = remove_if_exists(meta_path).await {
            tracing::warn!(?err, "failed to remove stale OTA meta");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sha256_bytes(bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        format!("{:x}", hasher.finalize())
    }

    #[tokio::test]
    async fn writes_resumes_and_verifies_on_done() {
        let temp = tempfile::TempDir::new().unwrap();
        let transfer = ChunkedTransfer::new(temp.path().to_path_buf());
        let body = b"nocturne ota transfer fixture";
        let sha = sha256_bytes(body);

        let received = transfer
            .begin("update-1", body.len() as u64, &sha)
            .await
            .unwrap();
        assert_eq!(received, 0);

        let first = &body[..9];
        let outcome = transfer
            .write_chunk("update-1", 0, first, false)
            .await
            .unwrap();
        assert_eq!(outcome, ChunkOutcome::More(first.len() as u64));

        let resumed = ChunkedTransfer::new(temp.path().to_path_buf());
        let received = resumed
            .begin("update-1", body.len() as u64, &sha)
            .await
            .unwrap();
        assert_eq!(received, first.len() as u64);

        let outcome = resumed
            .write_chunk("update-1", first.len() as u64, &body[first.len()..], true)
            .await
            .unwrap();
        assert_eq!(outcome, ChunkOutcome::Done);

        let written = tokio::fs::read(resumed.path("update-1")).await.unwrap();
        assert_eq!(written, body);
    }

    #[tokio::test]
    async fn resume_returns_existing_received_offset() {
        let temp = tempfile::TempDir::new().unwrap();
        let transfer = ChunkedTransfer::new(temp.path().to_path_buf());
        let body = b"hello resume world";
        let sha = sha256_bytes(body);

        transfer
            .begin("upd-resume", body.len() as u64, &sha)
            .await
            .unwrap();
        let first = &body[..5];
        transfer
            .write_chunk("upd-resume", 0, first, false)
            .await
            .unwrap();

        let transfer2 = ChunkedTransfer::new(temp.path().to_path_buf());
        let offset = transfer2
            .begin("upd-resume", body.len() as u64, &sha)
            .await
            .unwrap();
        assert_eq!(offset, first.len() as u64);
    }

    #[tokio::test]
    async fn begin_rejects_changed_metadata_for_existing_partial() {
        let temp = tempfile::TempDir::new().unwrap();
        let transfer = ChunkedTransfer::new(temp.path().to_path_buf());
        let body = b"immutable update metadata";
        let sha = sha256_bytes(body);

        transfer
            .begin("upd-metadata", body.len() as u64, &sha)
            .await
            .unwrap();
        transfer
            .write_chunk("upd-metadata", 0, &body[..5], false)
            .await
            .unwrap();

        let err = transfer
            .begin("upd-metadata", body.len() as u64 + 1, &sha)
            .await
            .unwrap_err();
        assert!(matches!(err, TransferError::MetadataMismatch));
        assert_eq!(
            tokio::fs::read(transfer.path("upd-metadata"))
                .await
                .unwrap(),
            &body[..5]
        );
    }

    #[tokio::test]
    async fn offset_mismatch_returns_error() {
        let temp = tempfile::TempDir::new().unwrap();
        let transfer = ChunkedTransfer::new(temp.path().to_path_buf());
        let body = b"offset mismatch test";
        let sha = sha256_bytes(body);

        transfer
            .begin("upd-offset", body.len() as u64, &sha)
            .await
            .unwrap();

        let err = transfer
            .write_chunk("upd-offset", 5, body, false)
            .await
            .unwrap_err();
        assert!(
            matches!(err, TransferError::OffsetMismatch { .. }),
            "expected OffsetMismatch, got {err:?}"
        );
    }

    #[tokio::test]
    async fn size_mismatch_returns_error() {
        let temp = tempfile::TempDir::new().unwrap();
        let transfer = ChunkedTransfer::new(temp.path().to_path_buf());
        let body = b"0123456789";
        let sha = sha256_bytes(body);

        transfer.begin("upd-size", 10, &sha).await.unwrap();

        let err = transfer
            .write_chunk("upd-size", 0, &body[..5], true)
            .await
            .unwrap_err();
        assert!(
            matches!(err, TransferError::SizeMismatch { .. }),
            "expected SizeMismatch, got {err:?}"
        );
    }

    #[tokio::test]
    async fn hash_mismatch_returns_error() {
        let temp = tempfile::TempDir::new().unwrap();
        let transfer = ChunkedTransfer::new(temp.path().to_path_buf());
        let body = b"correct bytes";
        let wrong_sha = sha256_bytes(b"wrong bytes");

        transfer
            .begin("upd-hash", body.len() as u64, &wrong_sha)
            .await
            .unwrap();

        let err = transfer
            .write_chunk("upd-hash", 0, body, true)
            .await
            .unwrap_err();
        assert!(
            matches!(err, TransferError::HashMismatch { .. }),
            "expected HashMismatch, got {err:?}"
        );
    }

    #[tokio::test]
    async fn done_outcome_when_size_and_hash_match() {
        let temp = tempfile::TempDir::new().unwrap();
        let transfer = ChunkedTransfer::new(temp.path().to_path_buf());
        let body = b"done outcome fixture";
        let sha = sha256_bytes(body);

        transfer
            .begin("upd-done", body.len() as u64, &sha)
            .await
            .unwrap();

        let outcome = transfer
            .write_chunk("upd-done", 0, body, true)
            .await
            .unwrap();
        assert_eq!(outcome, ChunkOutcome::Done);
    }

    #[tokio::test]
    async fn abandon_removes_files() {
        let temp = tempfile::TempDir::new().unwrap();
        let transfer = ChunkedTransfer::new(temp.path().to_path_buf());
        let body = b"abandon me";
        let sha = sha256_bytes(body);

        transfer
            .begin("upd-abandon", body.len() as u64, &sha)
            .await
            .unwrap();
        transfer
            .write_chunk("upd-abandon", 0, &body[..3], false)
            .await
            .unwrap();

        transfer.abandon("upd-abandon").await.unwrap();

        assert!(
            !transfer.path("upd-abandon").exists(),
            ".partial should be gone"
        );
        let meta_path = temp.path().join("upd-abandon.meta");
        assert!(!meta_path.exists(), ".meta should be gone");
    }

    #[tokio::test]
    async fn reaper_deletes_stale_pair() {
        let temp = tempfile::TempDir::new().unwrap();
        let transfer = ChunkedTransfer::new(temp.path().to_path_buf());
        let body = b"stale data";
        let sha = sha256_bytes(body);

        transfer
            .begin("stale-id", body.len() as u64, &sha)
            .await
            .unwrap();
        transfer
            .write_chunk("stale-id", 0, &body[..3], false)
            .await
            .unwrap();

        let partial_path = transfer.path("stale-id");
        let meta_path = temp.path().join("stale-id.meta");
        assert!(partial_path.exists());
        assert!(meta_path.exists());

        // Set mtime to 8 days ago (past the 7-day STALE_AFTER threshold)
        let eight_days_ago = std::time::SystemTime::now()
            .checked_sub(std::time::Duration::from_secs(8 * 24 * 60 * 60))
            .unwrap();
        let ft = filetime::FileTime::from_system_time(eight_days_ago);
        filetime::set_file_mtime(&meta_path, ft).unwrap();

        sweep_stale(temp.path()).await;

        assert!(
            !partial_path.exists(),
            ".partial should be deleted by reaper"
        );
        assert!(!meta_path.exists(), ".meta should be deleted by reaper");
    }

    #[tokio::test]
    async fn reaper_keeps_fresh_pair() {
        let temp = tempfile::TempDir::new().unwrap();
        let transfer = ChunkedTransfer::new(temp.path().to_path_buf());
        let body = b"fresh data";
        let sha = sha256_bytes(body);

        transfer
            .begin("fresh-id", body.len() as u64, &sha)
            .await
            .unwrap();
        transfer
            .write_chunk("fresh-id", 0, &body[..3], false)
            .await
            .unwrap();

        let partial_path = transfer.path("fresh-id");
        let meta_path = temp.path().join("fresh-id.meta");

        // mtime is "now" (fresh) — reaper must leave it alone
        sweep_stale(temp.path()).await;

        assert!(partial_path.exists(), ".partial should still exist");
        assert!(meta_path.exists(), ".meta should still exist");
    }
}
