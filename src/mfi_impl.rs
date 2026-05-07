use std::sync::Arc;

use async_trait::async_trait;
use iap2_rs::{Iap2Error, MfiAuthProvider, Result as Iap2Result};

use crate::mfi::MfiChip;

/// MFi authentication provider that wraps the hardware MfiChip.
pub struct HardwareMfiProvider {
    chip: Arc<MfiChip>,
}

impl HardwareMfiProvider {
    pub fn new() -> Self {
        HardwareMfiProvider {
            chip: Arc::new(MfiChip::new()),
        }
    }
}

#[async_trait]
impl MfiAuthProvider for HardwareMfiProvider {
    async fn read_certificate(&self) -> Iap2Result<Vec<u8>> {
        self.chip
            .read_certificate()
            .map_err(|e| Iap2Error::Mfi(e.to_string()))
    }

    async fn challenge_response(&self, challenge: &[u8]) -> Iap2Result<Vec<u8>> {
        self.chip
            .challenge_response(challenge)
            .map_err(|e| Iap2Error::Mfi(e.to_string()))
    }
}
