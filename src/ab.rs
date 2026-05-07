use crate::error::Result;
use crc32fast::Hasher;
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::{Read, Seek, SeekFrom, Write};

pub const AB_METADATA_MISC_PARTITION_OFFSET: usize = 2048;
pub const MISC_BUF_SIZE: usize = 2080;
pub const AB_MAGIC: [u8; 4] = [0x00, b'A', b'B', b'0'];
pub const AB_MAJOR_VERSION: u8 = 1;
pub const AB_MINOR_VERSION: u8 = 0;
pub const AB_DATA_SIZE: usize = 32;
pub const AB_MAX_PRIORITY: u8 = 15;
pub const AB_MAX_TRIES_REMAINING: u8 = 7;
pub const MISC_DEVICE_PATH: &str = "/dev/misc";

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct ABSlotData {
    pub priority: u8,
    pub tries_remaining: u8,
    pub successful_boot: u8,
    #[serde(skip)]
    pub reserved: u8,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ABData {
    #[serde(skip)]
    pub magic: [u8; 4],
    pub version_major: u8,
    pub version_minor: u8,
    #[serde(skip)]
    pub reserved1: [u8; 2],
    pub slots: [ABSlotData; 2],
    #[serde(skip)]
    pub reserved2: [u8; 12],
    pub crc32: u32,
}

impl ABData {
    pub fn validate(&self) -> bool {
        self.magic == AB_MAGIC && self.version_major <= AB_MAJOR_VERSION
    }

    pub fn reset(&mut self) {
        *self = ABData::default();
        self.magic = AB_MAGIC;
        self.version_major = AB_MAJOR_VERSION;
        self.version_minor = AB_MINOR_VERSION;
        self.slots[0].priority = AB_MAX_PRIORITY;
        self.slots[0].tries_remaining = AB_MAX_TRIES_REMAINING;
        self.slots[0].successful_boot = 0;
        self.slots[1].priority = AB_MAX_PRIORITY - 1;
        self.slots[1].tries_remaining = AB_MAX_TRIES_REMAINING;
        self.slots[1].successful_boot = 0;
    }

    pub fn get_active_slot(&self) -> usize {
        if self.slots[0].priority > self.slots[1].priority {
            0
        } else {
            1
        }
    }

    pub fn set_active_slot(&mut self, slot: usize) {
        let other = 1 - slot;

        self.slots[slot].priority = AB_MAX_PRIORITY;
        self.slots[slot].tries_remaining = AB_MAX_TRIES_REMAINING;
        self.slots[slot].successful_boot = 0;

        if self.slots[other].priority == AB_MAX_PRIORITY {
            self.slots[other].priority = AB_MAX_PRIORITY - 1;
        }
    }

    pub fn failover(&mut self) {
        let new_slot = 1 - self.get_active_slot();
        self.set_active_slot(new_slot);
    }

    pub fn set_successful_boot(&mut self, slot: usize) {
        self.slots[slot].tries_remaining = AB_MAX_TRIES_REMAINING;
        self.slots[slot].successful_boot = 1;
    }

    pub fn to_json_value(&self) -> serde_json::Value {
        let active = self.get_active_slot();
        let letter = if active == 0 { "A" } else { "B" };
        serde_json::json!({
            "active_slot": active,
            "active_slot_letter": letter,
            "version_major": self.version_major,
            "version_minor": self.version_minor,
            "slots": self.slots,
            "crc32": self.crc32,
        })
    }

    fn to_bytes_with_crc(&self, crc: u32) -> [u8; AB_DATA_SIZE] {
        let mut out = [0u8; AB_DATA_SIZE];
        out[0..4].copy_from_slice(&self.magic);
        out[4] = self.version_major;
        out[5] = self.version_minor;
        out[6..8].copy_from_slice(&self.reserved1);
        out[8] = self.slots[0].priority;
        out[9] = self.slots[0].tries_remaining;
        out[10] = self.slots[0].successful_boot;
        out[11] = self.slots[0].reserved;
        out[12] = self.slots[1].priority;
        out[13] = self.slots[1].tries_remaining;
        out[14] = self.slots[1].successful_boot;
        out[15] = self.slots[1].reserved;
        out[16..28].copy_from_slice(&self.reserved2);
        out[28] = ((crc >> 24) & 0xFF) as u8;
        out[29] = ((crc >> 16) & 0xFF) as u8;
        out[30] = ((crc >> 8) & 0xFF) as u8;
        out[31] = (crc & 0xFF) as u8;
        out
    }

    fn to_bytes_no_crc(&self) -> [u8; AB_DATA_SIZE] {
        self.to_bytes_with_crc(0)
    }

    fn from_bytes(bytes: &[u8]) -> ABData {
        let mut d = ABData::default();
        d.magic.copy_from_slice(&bytes[0..4]);
        d.version_major = bytes[4];
        d.version_minor = bytes[5];
        d.reserved1.copy_from_slice(&bytes[6..8]);
        d.slots[0].priority = bytes[8];
        d.slots[0].tries_remaining = bytes[9];
        d.slots[0].successful_boot = bytes[10];
        d.slots[0].reserved = bytes[11];
        d.slots[1].priority = bytes[12];
        d.slots[1].tries_remaining = bytes[13];
        d.slots[1].successful_boot = bytes[14];
        d.slots[1].reserved = bytes[15];
        d.reserved2.copy_from_slice(&bytes[16..28]);
        d.crc32 = ((bytes[28] as u32) << 24)
            | ((bytes[29] as u32) << 16)
            | ((bytes[30] as u32) << 8)
            | (bytes[31] as u32);
        d
    }

    fn calculate_crc32(&self) -> u32 {
        let bytes = self.to_bytes_no_crc();
        let mut hasher = Hasher::new();
        hasher.update(&bytes[0..(AB_DATA_SIZE - 4)]);
        hasher.finalize()
    }
}

pub fn open_and_load_ab_data() -> Result<ABData> {
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(MISC_DEVICE_PATH)?;

    let mut misc_buf = vec![0u8; MISC_BUF_SIZE];
    file.read_exact(&mut misc_buf)?;

    let start = AB_METADATA_MISC_PARTITION_OFFSET;
    let end = start + AB_DATA_SIZE;
    let slice = &misc_buf[start..end];
    let info = ABData::from_bytes(slice);

    if !info.validate() {
        return Err(crate::error::NocturnedError::General(anyhow::anyhow!(
            "invalid AB data"
        )));
    }

    Ok(info)
}

pub fn save_ab_data(mut info: ABData) -> Result<()> {
    let crc = info.calculate_crc32();
    info.crc32 = crc;
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(MISC_DEVICE_PATH)?;

    let mut misc_buf = vec![0u8; MISC_BUF_SIZE];
    file.read_exact(&mut misc_buf)?;

    let bytes = info.to_bytes_with_crc(crc);
    let start = AB_METADATA_MISC_PARTITION_OFFSET;
    misc_buf[start..start + AB_DATA_SIZE].copy_from_slice(&bytes);

    file.seek(SeekFrom::Start(0))?;
    file.write_all(&misc_buf)?;
    Ok(())
}
