use std::{
    io,
    path::{Path, PathBuf},
    process::ExitStatus,
};

use tokio::{fs, process::Command};

const WEBAPPS_DIR: &str = "webapps";
const UI_CURRENT: &str = "ui";
const UI_PREVIOUS: &str = "ui.previous";
const UI_NEXT: &str = "ui.next";

#[derive(Debug, Clone)]
pub struct WebappSwap {
    bandaid_root: PathBuf,
}

impl WebappSwap {
    pub fn new(bandaid_root: PathBuf) -> Self {
        Self { bandaid_root }
    }

    pub async fn install(&self, partial_path: &Path) -> Result<(), WebappSwapError> {
        let webapps_dir = self.bandaid_root.join(WEBAPPS_DIR);
        let current = webapps_dir.join(UI_CURRENT);
        let previous = webapps_dir.join(UI_PREVIOUS);
        let next = webapps_dir.join(UI_NEXT);

        fs::create_dir_all(&webapps_dir).await?;
        remove_dir_if_exists(&next).await?;
        remove_dir_if_exists(&previous).await?;
        fs::create_dir_all(&next).await?;

        let status = Command::new("tar")
            .arg("--zstd")
            .arg("-C")
            .arg(&next)
            .arg("-xf")
            .arg(partial_path)
            .status()
            .await?;
        if !status.success() {
            let _ = fs::remove_dir_all(&next).await;
            return Err(WebappSwapError::Cmd(status));
        }

        let had_current = fs::try_exists(&current).await?;
        if had_current {
            fs::rename(&current, &previous).await?;
        }

        if let Err(err) = fs::rename(&next, &current).await {
            if had_current {
                if let Err(rb) = fs::rename(&previous, &current).await {
                    tracing::error!(
                        ?rb,
                        "CRITICAL: failed to roll back webapp swap after promote rename failed; \
                         manual recovery required (previous webapp stranded at {previous:?})",
                        previous = previous,
                    );
                }
            }
            let _ = fs::remove_dir_all(&next).await;
            return Err(WebappSwapError::Io(err));
        }

        Ok(())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum WebappSwapError {
    #[error("io error: {0}")]
    Io(#[from] io::Error),
    #[error("command failed: {0}")]
    Cmd(ExitStatus),
}

async fn remove_dir_if_exists(path: &Path) -> io::Result<()> {
    match fs::remove_dir_all(path).await {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err),
    }
}
