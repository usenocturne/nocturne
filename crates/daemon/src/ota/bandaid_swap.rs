use std::{
    io,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
};

use tokio::fs;

const DAEMON_DIR: &str = "daemon";
const WEBAPPS_DIR: &str = "webapps";
const DAEMON_CURRENT: &str = "nocturned.current";
const DAEMON_PREVIOUS: &str = "nocturned.previous";
const DAEMON_NEXT: &str = "nocturned.next";
const UI_CURRENT: &str = "ui";
const UI_PREVIOUS: &str = "ui.previous";
const UI_NEXT: &str = "ui.next";
const STAGING_DIR: &str = ".bandaid.next";

#[derive(Debug, Clone)]
pub struct BandaidSwap {
    bandaid_root: PathBuf,
}

impl BandaidSwap {
    pub fn new(bandaid_root: PathBuf) -> Self {
        Self { bandaid_root }
    }

    pub async fn install(&self, archive_path: &Path) -> Result<(), BandaidSwapError> {
        let staging = self.bandaid_root.join(STAGING_DIR);
        fs::create_dir_all(&self.bandaid_root).await?;
        remove_path_if_exists(&staging).await?;
        fs::create_dir_all(&staging).await?;

        if let Err(err) = extract_archive(archive_path, &staging).await {
            let _ = fs::remove_dir_all(&staging).await;
            return Err(err.into());
        }

        let staged_daemon = staging.join(DAEMON_DIR).join(DAEMON_CURRENT);
        let staged_ui = staging.join(WEBAPPS_DIR).join(UI_CURRENT);
        validate_file(&staged_daemon, "daemon/nocturned.current").await?;
        validate_dir(&staged_ui, "webapps/ui").await?;
        validate_file(&staged_ui.join("index.html"), "webapps/ui/index.html").await?;
        fs::set_permissions(&staged_daemon, std::fs::Permissions::from_mode(0o755)).await?;

        let daemon_dir = self.bandaid_root.join(DAEMON_DIR);
        let webapps_dir = self.bandaid_root.join(WEBAPPS_DIR);
        fs::create_dir_all(&daemon_dir).await?;
        fs::create_dir_all(&webapps_dir).await?;

        let daemon_current = daemon_dir.join(DAEMON_CURRENT);
        let daemon_previous = daemon_dir.join(DAEMON_PREVIOUS);
        let daemon_next = daemon_dir.join(DAEMON_NEXT);
        let ui_current = webapps_dir.join(UI_CURRENT);
        let ui_previous = webapps_dir.join(UI_PREVIOUS);
        let ui_next = webapps_dir.join(UI_NEXT);

        remove_file_if_exists(&daemon_next).await?;
        remove_file_if_exists(&daemon_previous).await?;
        remove_dir_if_exists(&ui_next).await?;
        remove_dir_if_exists(&ui_previous).await?;

        fs::rename(&staged_daemon, &daemon_next).await?;
        fs::rename(&staged_ui, &ui_next).await?;
        promote_pair(
            &daemon_current,
            &daemon_previous,
            &daemon_next,
            &ui_current,
            &ui_previous,
            &ui_next,
        )
        .await?;

        let _ = fs::remove_dir_all(&staging).await;
        Ok(())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum BandaidSwapError {
    #[error("invalid bandaid package: {0}")]
    InvalidPackage(String),
    #[error("io error: {0}")]
    Io(#[from] io::Error),
}

async fn extract_archive(archive_path: &Path, dest: &Path) -> io::Result<()> {
    let archive_path = archive_path.to_path_buf();
    let dest = dest.to_path_buf();
    tokio::task::spawn_blocking(move || -> io::Result<()> {
        let file = std::fs::File::open(&archive_path)?;
        let decoder = zstd::stream::read::Decoder::new(file)?;
        let mut archive = tar::Archive::new(decoder);
        archive.set_preserve_mtime(false);
        archive.unpack(&dest)
    })
    .await
    .unwrap_or_else(|join_err| Err(io::Error::other(join_err)))
}

async fn promote_pair(
    daemon_current: &Path,
    daemon_previous: &Path,
    daemon_next: &Path,
    ui_current: &Path,
    ui_previous: &Path,
    ui_next: &Path,
) -> io::Result<()> {
    let had_daemon = fs::try_exists(daemon_current).await?;
    let had_ui = fs::try_exists(ui_current).await?;

    if had_daemon {
        fs::rename(daemon_current, daemon_previous).await?;
    }
    if had_ui {
        if let Err(err) = fs::rename(ui_current, ui_previous).await {
            rollback_file(daemon_previous, daemon_current, had_daemon).await;
            return Err(err);
        }
    }

    if let Err(err) = fs::rename(daemon_next, daemon_current).await {
        rollback_file(daemon_previous, daemon_current, had_daemon).await;
        rollback_dir(ui_previous, ui_current, had_ui).await;
        return Err(err);
    }

    if let Err(err) = fs::rename(ui_next, ui_current).await {
        if let Err(remove_err) = fs::remove_file(daemon_current).await {
            tracing::error!(
                ?remove_err,
                current = %daemon_current.display(),
                "CRITICAL: failed to remove newly promoted daemon during bandaid rollback"
            );
        }
        rollback_file(daemon_previous, daemon_current, had_daemon).await;
        rollback_dir(ui_previous, ui_current, had_ui).await;
        return Err(err);
    }

    Ok(())
}

async fn rollback_file(previous: &Path, current: &Path, should_restore: bool) {
    if !should_restore {
        return;
    }
    if let Err(err) = fs::rename(previous, current).await {
        tracing::error!(
            ?err,
            previous = %previous.display(),
            current = %current.display(),
            "CRITICAL: failed to roll back daemon during bandaid swap"
        );
    }
}

async fn rollback_dir(previous: &Path, current: &Path, should_restore: bool) {
    if !should_restore {
        return;
    }
    if let Err(err) = fs::rename(previous, current).await {
        tracing::error!(
            ?err,
            previous = %previous.display(),
            current = %current.display(),
            "CRITICAL: failed to roll back webapp during bandaid swap"
        );
    }
}

async fn validate_file(path: &Path, label: &str) -> Result<(), BandaidSwapError> {
    match fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.is_file() => Ok(()),
        Ok(_) => Err(BandaidSwapError::InvalidPackage(format!(
            "{label} is not a regular file"
        ))),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Err(BandaidSwapError::InvalidPackage(
            format!("{label} is missing"),
        )),
        Err(err) => Err(BandaidSwapError::Io(err)),
    }
}

async fn validate_dir(path: &Path, label: &str) -> Result<(), BandaidSwapError> {
    match fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.is_dir() => Ok(()),
        Ok(_) => Err(BandaidSwapError::InvalidPackage(format!(
            "{label} is not a directory"
        ))),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Err(BandaidSwapError::InvalidPackage(
            format!("{label} is missing"),
        )),
        Err(err) => Err(BandaidSwapError::Io(err)),
    }
}

async fn remove_path_if_exists(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path).await {
        Ok(metadata) if metadata.is_dir() => fs::remove_dir_all(path).await,
        Ok(_) => fs::remove_file(path).await,
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
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
    use std::io::{Cursor, Write};

    #[tokio::test]
    async fn install_replaces_daemon_and_ui_together() {
        let payload_dir = tempfile::TempDir::new().unwrap();
        let archive = payload_dir.path().join("payload.tar.zst");
        write_archive(
            &archive,
            Some(b"new daemon".as_slice()),
            Some(b"<html>new</html>".as_slice()),
        )
        .unwrap();

        let root = tempfile::TempDir::new().unwrap();
        let daemon_dir = root.path().join(DAEMON_DIR);
        let ui_dir = root.path().join(WEBAPPS_DIR).join(UI_CURRENT);
        std::fs::create_dir_all(&daemon_dir).unwrap();
        std::fs::create_dir_all(&ui_dir).unwrap();
        std::fs::write(daemon_dir.join(DAEMON_CURRENT), b"old daemon").unwrap();
        std::fs::write(ui_dir.join("index.html"), b"<html>old</html>").unwrap();

        BandaidSwap::new(root.path().to_path_buf())
            .install(&archive)
            .await
            .unwrap();

        assert_eq!(
            std::fs::read(daemon_dir.join(DAEMON_CURRENT)).unwrap(),
            b"new daemon"
        );
        assert_eq!(
            std::fs::read(daemon_dir.join(DAEMON_PREVIOUS)).unwrap(),
            b"old daemon"
        );
        assert_eq!(
            std::fs::read(
                root.path()
                    .join(WEBAPPS_DIR)
                    .join(UI_CURRENT)
                    .join("index.html")
            )
            .unwrap(),
            b"<html>new</html>"
        );
        assert_eq!(
            std::fs::read(
                root.path()
                    .join(WEBAPPS_DIR)
                    .join(UI_PREVIOUS)
                    .join("index.html")
            )
            .unwrap(),
            b"<html>old</html>"
        );
        let mode = std::fs::metadata(daemon_dir.join(DAEMON_CURRENT))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o755);
    }

    #[tokio::test]
    async fn install_rejects_archive_without_ui_index() {
        let payload_dir = tempfile::TempDir::new().unwrap();
        let archive = payload_dir.path().join("payload.tar.zst");
        write_archive(&archive, Some(b"new daemon".as_slice()), None).unwrap();

        let root = tempfile::TempDir::new().unwrap();
        let err = BandaidSwap::new(root.path().to_path_buf())
            .install(&archive)
            .await
            .unwrap_err();

        assert!(err.to_string().contains("webapps/ui"));
        assert!(!root.path().join(DAEMON_DIR).join(DAEMON_CURRENT).exists());
        assert!(!root.path().join(WEBAPPS_DIR).join(UI_CURRENT).exists());
    }

    fn write_archive(
        archive_path: &Path,
        daemon: Option<&[u8]>,
        ui_index: Option<&[u8]>,
    ) -> io::Result<()> {
        let file = std::fs::File::create(archive_path)?;
        let encoder = zstd::stream::write::Encoder::new(file, 0)?;
        let mut builder = tar::Builder::new(encoder);

        if let Some(body) = daemon {
            append_file(&mut builder, "daemon/nocturned.current", body, 0o755)?;
        }
        if let Some(body) = ui_index {
            append_file(&mut builder, "webapps/ui/index.html", body, 0o644)?;
        }

        let encoder = builder.into_inner()?;
        encoder.finish()?;
        Ok(())
    }

    fn append_file<W: Write>(
        builder: &mut tar::Builder<W>,
        path: &str,
        body: &[u8],
        mode: u32,
    ) -> io::Result<()> {
        let mut header = tar::Header::new_gnu();
        header.set_path(path)?;
        header.set_size(body.len() as u64);
        header.set_mode(mode);
        header.set_cksum();
        builder.append(&header, Cursor::new(body))
    }
}
