use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;
use tokio::sync::{Mutex, OnceCell};

const SETTINGS_PATH: &str = "/var/lib/nocturne/app-launch.json";
static SETTINGS: OnceCell<Mutex<AppLaunchStore>> = OnceCell::const_new();

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AppLaunchSettings {
    pub foreground: bool,
}

impl Default for AppLaunchSettings {
    fn default() -> Self {
        Self { foreground: true }
    }
}

struct AppLaunchStore {
    path: PathBuf,
    settings: AppLaunchSettings,
}

impl AppLaunchStore {
    async fn load(path: &Path) -> Result<Self> {
        let settings = match tokio::fs::read(path).await {
            Ok(bytes) => serde_json::from_slice(&bytes)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                AppLaunchSettings::default()
            }
            Err(error) => return Err(error.into()),
        };
        Ok(Self {
            path: path.to_owned(),
            settings,
        })
    }

    async fn set(&mut self, settings: AppLaunchSettings) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let temporary = self.path.with_extension("json.tmp");
        let bytes = serde_json::to_vec(&settings)?;
        let mut file = tokio::fs::File::create(&temporary).await?;
        file.write_all(&bytes).await?;
        file.sync_all().await?;
        tokio::fs::rename(&temporary, &self.path).await?;
        self.settings = settings;
        if let Some(parent) = self.path.parent() {
            tokio::fs::File::open(parent).await?.sync_all().await?;
        }
        Ok(())
    }
}

async fn store() -> Result<&'static Mutex<AppLaunchStore>> {
    SETTINGS
        .get_or_try_init(|| async {
            AppLaunchStore::load(Path::new(SETTINGS_PATH))
                .await
                .map(Mutex::new)
        })
        .await
}

pub async fn get() -> Result<AppLaunchSettings> {
    Ok(store().await?.lock().await.settings)
}

pub async fn set(settings: AppLaunchSettings) -> Result<AppLaunchSettings> {
    store().await?.lock().await.set(settings).await?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn defaults_to_foreground_and_retains_background_after_reload() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("state/app-launch.json");
        let mut store = AppLaunchStore::load(&path).await?;
        assert!(store.settings.foreground);
        store.set(AppLaunchSettings { foreground: false }).await?;
        assert!(!AppLaunchStore::load(&path).await?.settings.foreground);
        store.set(AppLaunchSettings { foreground: true }).await?;
        assert!(AppLaunchStore::load(&path).await?.settings.foreground);
        Ok(())
    }

    #[tokio::test]
    async fn invalid_saved_preference_does_not_enable_foreground_launch() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("app-launch.json");
        tokio::fs::write(&path, br#"{"foreground":"false"}"#).await?;
        assert!(AppLaunchStore::load(&path).await.is_err());
        Ok(())
    }

    #[tokio::test]
    async fn failed_save_preserves_current_preference() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("app-launch.json");
        let mut store = AppLaunchStore::load(&path).await?;
        tokio::fs::create_dir(&path).await?;
        assert!(store
            .set(AppLaunchSettings { foreground: false })
            .await
            .is_err());
        assert!(store.settings.foreground);
        Ok(())
    }
}
