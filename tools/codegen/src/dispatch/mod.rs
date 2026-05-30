//! Dispatch helper generation for the per-language SDKs.
//!
//! Walks `crates/lib/src/` to learn:
//! - The four top-level wire enums (`BridgeToGatewayMsgData`,
//!   `GatewayToBridgeMsgData`, `BridgeToClientMsgData`,
//!   `ClientToBridgeMsgData`).
//! - Inner enums referenced by those variants.
//! - Marker-trait impls inferred from `#[derive(BridgeEnum)]` per-variant
//!   tags + standalone `#[derive(WireEvent/WireCommand/WireUnicast)]`
//!   keyed off `#[wire(<Direction>, ...)]`.
//! - Typed-request declarations (`#[derive(WireRequest)]` keyed off
//!   `#[wire_request(...)]`).
//!
//! Builds one `Plan` per `Protocol` (Gateway, Client) and emits per-
//! language helper files. The TypeScript emitter has two entry points
//! (one per protocol - gateway and client are both web/JS-consumable).
//! Kotlin and Swift emitters target the gateway protocol only (they're
//! for native mobile apps).

pub mod casing;
pub mod inventory;
pub mod kotlin;
pub mod plan;
pub mod rust;
pub mod swift;
pub mod typescript;

pub use inventory::{Family, Protocol, inventory};
pub use plan::{build_plan_for, build_plans};
