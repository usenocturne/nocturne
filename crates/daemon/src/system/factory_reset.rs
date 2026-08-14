use std::{io, path::Path};

use tokio::{fs, process::Command};

pub(crate) const RESET_MARKER_PATH: &str = "/var/lib/nocturne/factory-reset.pending";
const RESET_DIRECTORIES: [&str; 5] = [
    "/var/lib/bluetooth",
    "/var/lib/chromium-kiosk",
    "/var/lib/nocturne/state",
    "/var/lib/nocturne/transfers",
    "/var/nocturne",
];
const RESET_FILES: [&str; 2] = [
    "/var/lib/nocturne/known-macos-connectors.json",
    "/var/lib/nocturne/ota-current.json",
];
const SERVICES_TO_STOP: [&str; 4] = [
    "chromium-kiosk.service",
    "superbird-weston.service",
    "bluetooth.service",
    "superbird-bluetooth.service",
];

pub(crate) async fn stage() -> std::io::Result<()> {
    stage_at(Path::new(RESET_MARKER_PATH)).await
}

pub(crate) async fn apply() -> io::Result<()> {
    let mut first_error = stop_runtime_services().await.err();

    for directory in RESET_DIRECTORIES {
        if let Err(error) = clear_children_at(Path::new(directory)).await {
            if first_error.is_none() {
                first_error = Some(error);
            }
        }
    }

    for file in RESET_FILES {
        if let Err(error) = remove_file_at(Path::new(file)).await {
            if first_error.is_none() {
                first_error = Some(error);
            }
        }
    }

    if let Some(error) = first_error {
        return Err(error);
    }

    remove_file_at(Path::new(RESET_MARKER_PATH)).await
}

async fn stage_at(path: &Path) -> std::io::Result<()> {
    fs::write(path, b"pending\n").await
}

async fn stop_runtime_services() -> io::Result<()> {
    let output = Command::new("systemctl")
        .arg("stop")
        .args(SERVICES_TO_STOP)
        .output()
        .await?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(io::Error::other(if stderr.is_empty() {
        format!("systemctl stop failed with status {}", output.status)
    } else {
        format!("systemctl stop failed: {stderr}")
    }))
}

async fn clear_children_at(path: &Path) -> io::Result<()> {
    let mut entries = match fs::read_dir(path).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };

    while let Some(entry) = entries.next_entry().await? {
        let child = entry.path();
        if entry.file_type().await?.is_dir() {
            fs::remove_dir_all(child).await?;
        } else {
            fs::remove_file(child).await?;
        }
    }

    Ok(())
}

async fn remove_file_at(path: &Path) -> io::Result<()> {
    match fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn stages_a_persistent_reset_marker() {
        let root = tempfile::tempdir().unwrap();
        let marker = root.path().join("nocturne/factory-reset.pending");
        fs::create_dir_all(marker.parent().unwrap()).await.unwrap();

        stage_at(&marker).await.unwrap();

        assert_eq!(fs::read_to_string(marker).await.unwrap(), "pending\n");
    }

    #[tokio::test]
    async fn clears_resettable_state_without_removing_the_root() {
        let root = tempfile::tempdir().unwrap();
        let state = root.path().join("state");
        fs::create_dir_all(state.join("nested")).await.unwrap();
        fs::write(state.join("settings"), b"settings")
            .await
            .unwrap();
        fs::write(state.join("nested/cache"), b"cache")
            .await
            .unwrap();

        clear_children_at(&state).await.unwrap();

        assert!(fs::metadata(&state).await.unwrap().is_dir());
        assert!(fs::read_dir(&state)
            .await
            .unwrap()
            .next_entry()
            .await
            .unwrap()
            .is_none());
    }
}
