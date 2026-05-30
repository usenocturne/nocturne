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

        move_cross_device_safe(partial_path, &next).await?;

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
        fs::set_permissions(&current, std::fs::Permissions::from_mode(0o755)).await?;

        Ok(())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum DaemonSwapError {
    #[error("io error: {0}")]
    Io(#[from] io::Error),
}

async fn move_cross_device_safe(from: &Path, to: &Path) -> io::Result<()> {
    match fs::rename(from, to).await {
        Ok(()) => Ok(()),
        Err(err) if err.raw_os_error() == Some(libc::EXDEV) => {
            fs::copy(from, to).await?;
            fs::remove_file(from).await
        }
        Err(err) => Err(err),
    }
}

async fn remove_file_if_exists(path: &Path) -> io::Result<()> {
    match fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err),
    }
}
