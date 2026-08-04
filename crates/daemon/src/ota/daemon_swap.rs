use std::{
    io,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
};

use tokio::fs;

const DAEMON_DIR: &str = "daemon";
const CURRENT_NAME: &str = "nocturned.current";
const PREVIOUS_NAME: &str = "nocturned.previous";
const NEXT_NAME: &str = "nocturned.next";

#[derive(Debug, Clone)]
pub struct DaemonSwap {
    bandaid_root: PathBuf,
}

impl DaemonSwap {
    pub fn new(bandaid_root: PathBuf) -> Self {
        Self { bandaid_root }
    }

    pub async fn install(&self, partial_path: &Path) -> Result<(), DaemonSwapError> {
        let daemon_dir = self.bandaid_root.join(DAEMON_DIR);
        let current = daemon_dir.join(CURRENT_NAME);
        let previous = daemon_dir.join(PREVIOUS_NAME);
        let next = daemon_dir.join(NEXT_NAME);

        fs::create_dir_all(&daemon_dir).await?;
        remove_file_if_exists(&next).await?;
        remove_file_if_exists(&previous).await?;

        fs::copy(partial_path, &next).await?;
        fs::set_permissions(&next, std::fs::Permissions::from_mode(0o755)).await?;

        let had_current = fs::try_exists(&current).await?;
        if had_current {
            fs::rename(&current, &previous).await?;
        }

        if let Err(err) = fs::rename(&next, &current).await {
            if had_current {
                if let Err(rb) = fs::rename(&previous, &current).await {
                    tracing::error!(
                        ?rb,
                        "CRITICAL: failed to roll back daemon swap after promote rename failed; \
                         manual recovery required (previous binary stranded at {previous:?})",
                        previous = previous,
                    );
                }
            }
            return Err(DaemonSwapError::Io(err));
        }
        Ok(())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum DaemonSwapError {
    #[error("io error: {0}")]
    Io(#[from] io::Error),
}

async fn remove_file_if_exists(path: &Path) -> io::Result<()> {
    match fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn install_preserves_verified_payload_until_actor_cleanup() {
        let root = tempfile::TempDir::new().unwrap();
        let partial = root.path().join("update.partial");
        tokio::fs::write(&partial, b"new daemon").await.unwrap();

        DaemonSwap::new(root.path().join("bandaid"))
            .install(&partial)
            .await
            .unwrap();

        assert_eq!(tokio::fs::read(&partial).await.unwrap(), b"new daemon");
        assert_eq!(
            tokio::fs::read(root.path().join("bandaid/daemon/nocturned.current"))
                .await
                .unwrap(),
            b"new daemon"
        );
    }
}
