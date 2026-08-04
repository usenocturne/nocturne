use std::collections::{HashMap, HashSet};

use iap2_rs::csm::telephony::CallStateUpdate;
use libnocturne::generated::phone::{
    PhoneCallEndedEvent, PhoneCallStartedEvent, PhoneCallUpdatedEvent,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CallStatus {
    Disconnected,
    Sending,
    Ringing,
    Connecting,
    Active,
    Held,
    Disconnecting,
}

impl CallStatus {
    fn from_iap2(value: u8) -> Self {
        match value {
            1 => Self::Sending,
            2 => Self::Ringing,
            3 => Self::Connecting,
            4 => Self::Active,
            5 => Self::Held,
            6 => Self::Disconnecting,
            _ => Self::Disconnected,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Disconnected => "disconnected",
            Self::Sending => "sending",
            Self::Ringing => "ringing",
            Self::Connecting => "connecting",
            Self::Active => "active",
            Self::Held => "held",
            Self::Disconnecting => "disconnecting",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CallDirection {
    Incoming,
    Outgoing,
}

impl CallDirection {
    fn from_iap2(value: u8) -> Self {
        match value {
            2 => Self::Outgoing,
            _ => Self::Incoming,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Incoming => "incoming",
            Self::Outgoing => "outgoing",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CallService {
    Unknown,
    Telephony,
    FaceTimeAudio,
    FaceTimeVideo,
}

impl CallService {
    fn from_iap2(value: u8) -> Self {
        match value {
            1 => Self::Telephony,
            2 => Self::FaceTimeAudio,
            3 => Self::FaceTimeVideo,
            _ => Self::Unknown,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Telephony => "telephony",
            Self::FaceTimeAudio => "facetime_audio",
            Self::FaceTimeVideo => "facetime_video",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CallSnapshot {
    call_id: String,
    remote_id: String,
    display_name: String,
    status: CallStatus,
    direction: CallDirection,
    label: Option<String>,
    service: Option<CallService>,
    started_at_unix_s: Option<i64>,
}

impl CallSnapshot {
    fn new(call_id: String) -> Self {
        Self {
            call_id,
            remote_id: String::new(),
            display_name: String::new(),
            status: CallStatus::Disconnected,
            direction: CallDirection::Incoming,
            label: None,
            service: None,
            started_at_unix_s: None,
        }
    }

    fn started_event(&self, device: &str) -> PhoneCallStartedEvent {
        PhoneCallStartedEvent {
            call_id: self.call_id.clone(),
            device: device.to_string(),
            remote_id: self.remote_id.clone(),
            display_name: self.display_name.clone(),
            status: self.status.as_str().to_string(),
            direction: self.direction.as_str().to_string(),
            label: self.label.clone(),
            service: self.service.map(|service| service.as_str().to_string()),
            started_at_unix_s: self.started_at_unix_s,
        }
    }

    fn updated_event(&self, device: &str) -> PhoneCallUpdatedEvent {
        PhoneCallUpdatedEvent {
            call_id: self.call_id.clone(),
            device: device.to_string(),
            remote_id: self.remote_id.clone(),
            display_name: self.display_name.clone(),
            status: self.status.as_str().to_string(),
            direction: self.direction.as_str().to_string(),
            label: self.label.clone(),
            service: self.service.map(|service| service.as_str().to_string()),
            started_at_unix_s: self.started_at_unix_s,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(super) enum CallLifecycleEvent {
    Started(PhoneCallStartedEvent),
    Updated(PhoneCallUpdatedEvent),
    Ended(PhoneCallEndedEvent),
}

#[derive(Debug)]
pub(super) struct CallTracker {
    device: String,
    calls: HashMap<String, CallSnapshot>,
    announced: HashSet<String>,
}

impl CallTracker {
    pub(super) fn new(device: impl Into<String>) -> Self {
        Self {
            device: device.into(),
            calls: HashMap::new(),
            announced: HashSet::new(),
        }
    }

    pub(super) fn apply(&mut self, update: CallStateUpdate) -> Vec<CallLifecycleEvent> {
        let Some(call_id) = self.resolve_call_id(&update) else {
            return Vec::new();
        };

        let next_status = update.status.map(CallStatus::from_iap2);
        let prior_status = self.calls.get(&call_id).map(|call| call.status);
        let entry = self
            .calls
            .entry(call_id.clone())
            .or_insert_with(|| CallSnapshot::new(call_id.clone()));

        if let Some(remote_id) = update.remote_id {
            entry.remote_id = remote_id;
        }
        if let Some(display_name) = update.display_name {
            entry.display_name = display_name;
        }
        if let Some(status) = next_status {
            entry.status = status;
        }
        if let Some(direction) = update.direction {
            entry.direction = CallDirection::from_iap2(direction);
        }
        if let Some(label) = update.label {
            entry.label = Some(label);
        }
        if let Some(service) = update.service {
            entry.service = Some(CallService::from_iap2(service));
        }
        if let Some(started_at_unix_s) = update.start_timestamp_unix_s {
            entry.started_at_unix_s = Some(started_at_unix_s);
        }

        let snapshot = entry.clone();
        if next_status == Some(CallStatus::Disconnected) {
            self.calls.remove(&call_id);
            if !self.announced.remove(&call_id) {
                return Vec::new();
            }
            return vec![CallLifecycleEvent::Ended(PhoneCallEndedEvent {
                call_id,
                device: self.device.clone(),
                reason: end_reason(
                    update.disconnect_reason,
                    prior_status.unwrap_or(CallStatus::Disconnected),
                    snapshot.direction,
                )
                .to_string(),
            })];
        }

        if snapshot.status == CallStatus::Disconnected {
            return Vec::new();
        }
        if self.announced.insert(call_id) {
            vec![CallLifecycleEvent::Started(
                snapshot.started_event(&self.device),
            )]
        } else {
            vec![CallLifecycleEvent::Updated(
                snapshot.updated_event(&self.device),
            )]
        }
    }

    pub(super) fn snapshot(&self) -> Vec<serde_json::Value> {
        self.calls
            .values()
            .filter(|call| self.announced.contains(&call.call_id))
            .map(|call| {
                serde_json::to_value(call.updated_event(&self.device))
                    .expect("generated phone call snapshot must serialize")
            })
            .collect()
    }

    pub(super) fn is_ringing_incoming(&self, call_id: &str) -> bool {
        self.calls.get(call_id).is_some_and(|call| {
            self.announced.contains(call_id)
                && call.status == CallStatus::Ringing
                && call.direction == CallDirection::Incoming
        })
    }

    pub(super) fn drain(&mut self, reason: &str) -> Vec<CallLifecycleEvent> {
        let events = self
            .announced
            .drain()
            .map(|call_id| {
                CallLifecycleEvent::Ended(PhoneCallEndedEvent {
                    call_id,
                    device: self.device.clone(),
                    reason: reason.to_string(),
                })
            })
            .collect();
        self.calls.clear();
        events
    }

    fn resolve_call_id(&self, update: &CallStateUpdate) -> Option<String> {
        if let Some(call_id) = update.call_uuid.as_ref() {
            return Some(call_id.clone());
        }
        if self.calls.len() != 1 {
            return None;
        }
        let existing = self.calls.values().next()?;
        untagged_is_state_advance(update, existing).then(|| existing.call_id.clone())
    }
}

fn untagged_is_state_advance(update: &CallStateUpdate, existing: &CallSnapshot) -> bool {
    if let Some(remote_id) = update.remote_id.as_deref() {
        if !remote_id.is_empty()
            && !existing.remote_id.is_empty()
            && remote_id != existing.remote_id
        {
            return false;
        }
    }
    if let Some(status) = update.status.map(CallStatus::from_iap2) {
        let is_start = matches!(status, CallStatus::Sending | CallStatus::Ringing);
        let existing_is_start =
            matches!(existing.status, CallStatus::Sending | CallStatus::Ringing);
        if is_start && !existing_is_start {
            return false;
        }
    }
    true
}

fn end_reason(
    disconnect_reason: Option<u8>,
    prior_status: CallStatus,
    direction: CallDirection,
) -> &'static str {
    match disconnect_reason {
        Some(1) => "declined",
        Some(2) => "failed",
        _ if prior_status == CallStatus::Ringing && direction == CallDirection::Incoming => {
            "missed"
        }
        _ => "remote",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn update(call_id: Option<&str>, remote_id: Option<&str>, status: u8) -> CallStateUpdate {
        CallStateUpdate {
            call_uuid: call_id.map(str::to_string),
            remote_id: remote_id.map(str::to_string),
            status: Some(status),
            direction: Some(1),
            ..Default::default()
        }
    }

    #[test]
    fn first_ringing_state_starts_a_complete_call() {
        let mut tracker = CallTracker::new("AA:BB:CC:DD:EE:FF");
        let mut incoming = update(Some("call-1"), Some("+15555550100"), 2);
        incoming.display_name = Some("Test Caller".to_string());

        let events = tracker.apply(incoming);

        assert!(matches!(
            events.as_slice(),
            [CallLifecycleEvent::Started(call)]
                if call.call_id == "call-1"
                    && call.remote_id == "+15555550100"
                    && call.display_name == "Test Caller"
                    && call.status == "ringing"
                    && call.direction == "incoming"
        ));
        assert!(tracker.is_ringing_incoming("call-1"));
    }

    #[test]
    fn sparse_status_update_preserves_caller_identity() {
        let mut tracker = CallTracker::new("AA:BB:CC:DD:EE:FF");
        let mut incoming = update(Some("call-1"), Some("+15555550100"), 2);
        incoming.display_name = Some("Test Caller".to_string());
        tracker.apply(incoming);

        let events = tracker.apply(CallStateUpdate {
            call_uuid: Some("call-1".to_string()),
            status: Some(4),
            ..Default::default()
        });

        assert!(matches!(
            events.as_slice(),
            [CallLifecycleEvent::Updated(call)]
                if call.remote_id == "+15555550100"
                    && call.display_name == "Test Caller"
                    && call.status == "active"
        ));
    }

    #[test]
    fn disconnected_call_is_evicted_as_missed() {
        let mut tracker = CallTracker::new("AA:BB:CC:DD:EE:FF");
        tracker.apply(update(Some("call-1"), Some("+15555550100"), 2));

        let events = tracker.apply(update(Some("call-1"), None, 0));

        assert!(matches!(
            events.as_slice(),
            [CallLifecycleEvent::Ended(ended)]
                if ended.call_id == "call-1" && ended.reason == "missed"
        ));
        assert!(tracker.snapshot().is_empty());
    }

    #[test]
    fn uuidless_delta_advances_only_one_unambiguous_call() {
        let mut tracker = CallTracker::new("AA:BB:CC:DD:EE:FF");
        tracker.apply(update(Some("call-1"), Some("+15555550100"), 2));

        let events = tracker.apply(update(None, None, 4));

        assert!(matches!(
            events.as_slice(),
            [CallLifecycleEvent::Updated(call)]
                if call.call_id == "call-1" && call.status == "active"
        ));
    }

    #[test]
    fn ambiguous_uuidless_delta_is_dropped() {
        let mut tracker = CallTracker::new("AA:BB:CC:DD:EE:FF");
        tracker.apply(update(Some("call-1"), Some("+15555550100"), 4));
        tracker.apply(update(Some("call-2"), Some("+15555550101"), 2));

        assert!(tracker.apply(update(None, None, 4)).is_empty());
        assert_eq!(tracker.snapshot().len(), 2);
    }

    #[test]
    fn draining_ends_every_announced_call() {
        let mut tracker = CallTracker::new("AA:BB:CC:DD:EE:FF");
        tracker.apply(update(Some("call-1"), Some("+15555550100"), 2));
        tracker.apply(update(Some("call-2"), Some("+15555550101"), 2));

        let events = tracker.drain("connection_lost");

        assert_eq!(events.len(), 2);
        assert!(events.iter().all(|event| matches!(
            event,
            CallLifecycleEvent::Ended(ended) if ended.reason == "connection_lost"
        )));
        assert!(tracker.snapshot().is_empty());
    }
}
