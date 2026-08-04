use std::{io, path::Path};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PersistedState {
    pub update_id: String,
    pub kind: libnocturne::OtaKind,
    pub expected_size: u64,
    pub expected_sha256: String,
    #[serde(default)]
    pub target_version: Option<String>,
    #[serde(default)]
    pub transfer_window_size: Option<u32>,
    pub peer: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ManifestError {
    #[error("io error: {0}")]
    Io(#[from] io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

pub async fn save(state_dir: &Path, state: &PersistedState) -> Result<(), ManifestError> {
    tokio::fs::create_dir_all(state_dir).await?;
    let state_dir = state_dir.to_path_buf();
    let bytes = serde_json::to_vec(state)?;

    tokio::task::spawn_blocking(move || -> Result<(), ManifestError> {
        let mut tmp = tempfile::NamedTempFile::new_in(&state_dir)?;
        std::io::Write::write_all(&mut tmp, &bytes)?;
        std::io::Write::flush(&mut tmp)?;
        tmp.persist(state_dir.join("ota-current.json"))
            .map_err(|err| ManifestError::Io(err.error))?;
        Ok(())
    })
    .await
    .map_err(io::Error::other)??;

    Ok(())
}

pub async fn clear(state_dir: &Path) -> Result<(), ManifestError> {
    match tokio::fs::remove_file(state_dir.join("ota-current.json")).await {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.into()),
    }
}

pub async fn load(state_dir: &Path) -> Result<Option<PersistedState>, ManifestError> {
    let path = state_dir.join("ota-current.json");
    match tokio::fs::read(&path).await {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.into()),
    }
}
