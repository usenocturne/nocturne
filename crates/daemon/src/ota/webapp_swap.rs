use std::{
    io,
    path::{Path, PathBuf},
};

use tokio::fs;

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
        fs::create_dir_all(&next).await?;

        // Decompress + extract the zstd tarball in-process. The device image
        // ships libzstd but NOT the `zstd` CLI that `tar --zstd` shells out to,
        // so depending on an external binary here silently breaks bandaid OTA.
        let archive_path = partial_path.to_path_buf();
        let dest = next.clone();
        let extract = tokio::task::spawn_blocking(move || -> io::Result<()> {
            let file = std::fs::File::open(&archive_path)?;
            let decoder = zstd::stream::read::Decoder::new(file)?;
            let mut archive = tar::Archive::new(decoder);
            archive.set_preserve_mtime(false);
            archive.unpack(&dest)
        })
        .await
        .unwrap_or_else(|join_err| Err(io::Error::other(join_err)));
        if let Err(err) = extract {
            let _ = fs::remove_dir_all(&next).await;
            return Err(WebappSwapError::Io(err));
        }

        let index = next.join("index.html");
        match fs::symlink_metadata(&index).await {
            Ok(metadata) if metadata.file_type().is_file() => {}
            Ok(_) => {
                let _ = fs::remove_dir_all(&next).await;
                return Err(WebappSwapError::InvalidPackage(
                    "index.html is not a regular file".into(),
                ));
            }
            Err(err) if err.kind() == io::ErrorKind::NotFound => {
                let _ = fs::remove_dir_all(&next).await;
                return Err(WebappSwapError::InvalidPackage(
                    "index.html is missing".into(),
                ));
            }
            Err(err) => {
                let _ = fs::remove_dir_all(&next).await;
                return Err(WebappSwapError::Io(err));
            }
        }

        remove_dir_if_exists(&previous).await?;
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
    #[error("invalid webapp package: {0}")]
    InvalidPackage(String),
    #[error("io error: {0}")]
    Io(#[from] io::Error),
}

async fn remove_dir_if_exists(path: &Path) -> io::Result<()> {
    match fs::remove_dir_all(path).await {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_archive(path: &Path, entries: &[(&str, &[u8])]) {
        let file = std::fs::File::create(path).unwrap();
        let encoder = zstd::stream::write::Encoder::new(file, 1).unwrap();
        let mut archive = tar::Builder::new(encoder);
        for (name, bytes) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_size(bytes.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            archive.append_data(&mut header, *name, *bytes).unwrap();
        }
        let encoder = archive.into_inner().unwrap();
        encoder.finish().unwrap();
    }

    #[tokio::test]
    async fn install_promotes_a_valid_webapp() {
        let temp = tempfile::TempDir::new().unwrap();
        let archive = temp.path().join("webapp.tar.zst");
        write_archive(&archive, &[("index.html", b"new ui")]);
        let root = temp.path().join("bandaid");
        let current = root.join("webapps/ui");
        let previous = root.join("webapps/ui.previous");
        fs::create_dir_all(&current).await.unwrap();
        fs::create_dir_all(&previous).await.unwrap();
        fs::write(current.join("index.html"), b"old ui")
            .await
            .unwrap();
        fs::write(previous.join("index.html"), b"older ui")
            .await
            .unwrap();

        WebappSwap::new(root.clone())
            .install(&archive)
            .await
            .unwrap();

        assert_eq!(
            fs::read(current.join("index.html")).await.unwrap(),
            b"new ui"
        );
        assert_eq!(
            fs::read(root.join("webapps/ui.previous/index.html"))
                .await
                .unwrap(),
            b"old ui"
        );
    }

    #[tokio::test]
    async fn invalid_webapp_does_not_replace_the_active_ui() {
        let temp = tempfile::TempDir::new().unwrap();
        let archive = temp.path().join("webapp.tar.zst");
        write_archive(&archive, &[("assets/app.js", b"missing index")]);
        let root = temp.path().join("bandaid");
        let current = root.join("webapps/ui");
        let previous = root.join("webapps/ui.previous");
        fs::create_dir_all(&current).await.unwrap();
        fs::create_dir_all(&previous).await.unwrap();
        fs::write(current.join("index.html"), b"old ui")
            .await
            .unwrap();
        fs::write(previous.join("index.html"), b"older ui")
            .await
            .unwrap();

        let error = WebappSwap::new(root.clone())
            .install(&archive)
            .await
            .unwrap_err();

        assert!(matches!(error, WebappSwapError::InvalidPackage(_)));
        assert_eq!(
            fs::read(current.join("index.html")).await.unwrap(),
            b"old ui"
        );
        assert_eq!(
            fs::read(previous.join("index.html")).await.unwrap(),
            b"older ui"
        );
        assert!(!fs::try_exists(root.join("webapps/ui.next")).await.unwrap());
    }
}
