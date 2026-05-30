use std::path::Path;

use tokio::{
    sync::mpsc,
    time::{sleep, Duration},
};

use super::{OtaPhase, SwupdateError, SwupdateEvent};

pub struct Swupdate;

impl Swupdate {
    pub async fn run(
        swu_path: &Path,
        selector: &str,
        event_tx: mpsc::Sender<SwupdateEvent>,
    ) -> Result<(), SwupdateError> {
        tracing::info!(?swu_path, selector, "stub swupdate: would install");

        for percent in [0, 50, 100] {
            let event = SwupdateEvent {
                phase: OtaPhase::Writing,
                percent,
            };
            if event_tx.send(event).await.is_err() {
                tracing::debug!("stub swupdate: progress receiver dropped");
                return Ok(());
            }
            sleep(Duration::from_millis(100)).await;
        }

        Ok(())
    }
}
