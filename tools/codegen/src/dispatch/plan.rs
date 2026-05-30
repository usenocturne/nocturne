//! Aggregates the inventory into per-surface buckets that the
//! per-language emitters consume directly. A "surface" maps to one
//! top-level wire variant (e.g. `Asset`) and bundles every method that
//! belongs in the `<entry>.<surface>` namespace: inbound listeners,
//! outbound sends, typed queries, and typed inbound request handles.
//!
//! The plan is built per `Protocol`; per-language emitters take a single
//! `Plan` and emit one dispatch file per protocol invocation.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{Result, anyhow};

use super::inventory::{
    Direction, EnumDef, Inventory, MarkerKind, PayloadType, Protocol, TypedRequest, WireVariant,
};

#[derive(Debug, Clone)]
pub struct DispatchEntry {
    /// Wire `data.type` discriminator (e.g. `"asset"`, `"transport"`).
    pub outer_disc: String,
    /// Outer variant name in PascalCase (e.g. `"Asset"`).
    pub outer_variant: String,
    /// Outer payload type - `None` for unit variants.
    pub outer_payload: Option<PayloadType>,
    /// Inner enum variants (when `outer_payload` is a `Named` type that
    /// resolves to an adjacent-tagged enum). Empty otherwise.
    pub inner_variants: Vec<InnerVariantPlan>,
    /// Inner enum's adjacent-tagged discriminator field name.
    pub inner_tag_field: Option<String>,
    /// Direction of the wire (which side receives this).
    pub direction: Direction,
    /// Event-vs-Command tag. Determines wire `meta` for outbound emit.
    pub category: EntryCategory,
    /// True when the variant is marked `WireUnicast`.
    pub unicast: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryCategory {
    Event,
    Command,
    Skip,
}

impl EntryCategory {
    pub fn meta_kind(self) -> &'static str {
        match self {
            Self::Event => "event",
            Self::Command => "command",
            Self::Skip => "event",
        }
    }
}

#[derive(Debug, Clone)]
pub struct InnerVariantPlan {
    pub disc: String,
    pub variant: String,
    pub payload: Option<PayloadType>,
    /// Outbound codegen skips struct variants - payload would need full
    /// per-field args.
    pub is_struct: bool,
    /// Per-variant outbound bucket. Inferred from the variant's
    /// `#[bridge_event]` / `#[bridge_command]` tag. Unset for
    /// request/response variants and for outer wire enums.
    pub category: Option<EntryCategory>,
}

pub struct Plan {
    pub protocol: Protocol,
    pub entries: Vec<DispatchEntry>,
    /// Outbound typed requests for this protocol's outbound direction.
    pub outbound_requests: Vec<TypedRequestEntry>,
    /// Inbound typed requests for this protocol's outbound direction
    /// (i.e. the OPPOSITE direction sends a request, this side handles it).
    pub inbound_requests: Vec<TypedRequestEntry>,
}

/// Per-language emitters consume `Surface`s - aggregations of
/// inbound + outbound entries for a single top-level wire variant
/// (e.g. all `Asset`-related methods for the `<entry>.asset` namespace).
#[derive(Debug, Clone)]
pub struct Surface {
    /// PascalCase outer variant (e.g. `"Asset"`).
    pub name: String,
    /// camelCase property name on the entry class (e.g. `"asset"`).
    pub prop: String,
    /// Inbound dispatch entry - bridge → counterparty direction.
    pub inbound: Option<DispatchEntry>,
    /// Outbound dispatch entry - counterparty → bridge direction.
    pub outbound: Option<DispatchEntry>,
    /// Counterparty → bridge typed requests scoped to this surface.
    pub outbound_queries: Vec<TypedRequestEntry>,
    /// Bridge → counterparty typed requests scoped to this surface.
    pub inbound_requests: Vec<TypedRequestEntry>,
}

impl Surface {
    /// Inner variants of the inbound-side payload that should be exposed
    /// as event-shape callbacks. Excludes inner variants that map to a
    /// typed inbound request - those are handled via the request-handle
    /// pattern. Filters by both payload type (the struct case) and
    /// variant name (the no-payload-marker case, e.g.
    /// `pub enum X { #[bridge_request] StateGet }` with marker struct
    /// `XStateGet`).
    pub fn inbound_event_variants(&self) -> Vec<&InnerVariantPlan> {
        let bridge_request_payloads: BTreeSet<&str> = self
            .inbound_requests
            .iter()
            .map(|r| r.request.as_str())
            .collect();
        let bridge_request_variants: BTreeSet<String> = self
            .inbound_requests
            .iter()
            .map(|r| r.request_variant_pascal())
            .collect();
        self.inbound
            .as_ref()
            .map(|e| {
                e.inner_variants
                    .iter()
                    .filter(|iv| {
                        if bridge_request_variants.contains(&iv.variant) {
                            return false;
                        }
                        match &iv.payload {
                            Some(PayloadType::Named(n)) => {
                                !bridge_request_payloads.contains(n.as_str())
                            }
                            _ => true,
                        }
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Inner variants of the outbound-side payload that should be exposed
    /// as outbound methods. Skips struct-shaped variants and any variant
    /// whose name matches a typed-request response/error.
    pub fn outbound_send_variants(&self) -> Vec<&InnerVariantPlan> {
        let mut response_variants: BTreeSet<String> = BTreeSet::new();
        for r in &self.inbound_requests {
            response_variants.insert(r.response_variant_pascal());
            if let Some(e) = r.error_variant_pascal() {
                response_variants.insert(e);
            }
        }
        let mut request_variants: BTreeSet<String> = BTreeSet::new();
        for r in &self.outbound_queries {
            request_variants.insert(r.request_variant_pascal());
        }
        self.outbound
            .as_ref()
            .map(|e| {
                e.inner_variants
                    .iter()
                    .filter(|iv| {
                        !iv.is_struct
                            && !response_variants.contains(iv.variant.as_str())
                            && !request_variants.contains(iv.variant.as_str())
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
}

#[derive(Debug, Clone)]
pub struct TypedRequestEntry {
    pub request: String,
    pub request_takes_payload: bool,
    pub response: String,
    pub error: Option<String>,
    /// Outer variant in `<Direction>MsgData`, in PascalCase (e.g. `"Webapp"`).
    pub surface: String,
    /// Camel-case wire discriminator for the outer (e.g. `"webapp"`).
    pub surface_disc: String,
    /// Inner-enum adjacent-tagged tag field (e.g. `"event"`).
    pub inner_tag: String,
    /// Camel-case wire discriminator for the request inner variant.
    pub request_disc: String,
    pub response_disc: String,
    pub error_disc: Option<String>,
}

impl TypedRequestEntry {
    pub fn response_variant_pascal(&self) -> String {
        upper_first(&self.response_disc)
    }
    pub fn error_variant_pascal(&self) -> Option<String> {
        self.error_disc.as_deref().map(upper_first)
    }
    pub fn request_variant_pascal(&self) -> String {
        upper_first(&self.request_disc)
    }
}

pub fn upper_first(s: &str) -> String {
    let mut chars = s.chars();
    let mut out = String::new();
    if let Some(c) = chars.next() {
        out.extend(c.to_uppercase());
    }
    out.extend(chars);
    out
}

/// PascalCase -> camelCase, lower-casing the leading single capital.
pub fn rename_camel(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    if let Some(first) = chars.next() {
        out.extend(first.to_lowercase());
    }
    out.extend(chars);
    out
}

pub fn surfaces(plan: &Plan) -> Vec<Surface> {
    let mut by_name: BTreeMap<String, Surface> = BTreeMap::new();
    let mut order: Vec<String> = Vec::new();

    let touch = |name: &str, by_name: &mut BTreeMap<String, Surface>, order: &mut Vec<String>| {
        if !by_name.contains_key(name) {
            by_name.insert(
                name.to_string(),
                Surface {
                    name: name.to_string(),
                    prop: rename_camel(name),
                    inbound: None,
                    outbound: None,
                    outbound_queries: Vec::new(),
                    inbound_requests: Vec::new(),
                },
            );
            order.push(name.to_string());
        }
    };

    let inbound_dir = plan.protocol.inbound_direction();
    let outbound_dir = plan.protocol.outbound_direction();

    for e in plan.entries.iter().filter(|e| e.direction == inbound_dir) {
        touch(&e.outer_variant, &mut by_name, &mut order);
        by_name.get_mut(&e.outer_variant).unwrap().inbound = Some(e.clone());
    }
    for e in plan.entries.iter().filter(|e| e.direction == outbound_dir) {
        touch(&e.outer_variant, &mut by_name, &mut order);
        by_name.get_mut(&e.outer_variant).unwrap().outbound = Some(e.clone());
    }
    for r in &plan.outbound_requests {
        touch(&r.surface, &mut by_name, &mut order);
        by_name
            .get_mut(&r.surface)
            .unwrap()
            .outbound_queries
            .push(r.clone());
    }
    for r in &plan.inbound_requests {
        touch(&r.surface, &mut by_name, &mut order);
        by_name
            .get_mut(&r.surface)
            .unwrap()
            .inbound_requests
            .push(r.clone());
    }

    order
        .into_iter()
        .map(|n| by_name.remove(&n).unwrap())
        .collect()
}

impl Protocol {
    /// Direction of messages flowing INTO the SDK consumer (i.e. that the
    /// SDK consumer receives and listens to).
    pub fn inbound_direction(self) -> Direction {
        match self {
            // Gateway SDK consumer = companion (mobile/desktop app);
            // it receives BridgeToGateway.
            Self::Gateway => Direction::BridgeToGateway,
            // Client SDK consumer = webapp;
            // it receives BridgeToClient.
            Self::Client => Direction::BridgeToClient,
        }
    }

    /// Direction of messages flowing OUT of the SDK consumer.
    pub fn outbound_direction(self) -> Direction {
        match self {
            Self::Gateway => Direction::GatewayToBridge,
            Self::Client => Direction::ClientToBridge,
        }
    }
}

/// Build one `Plan` per `Protocol` from the inventory.
pub fn build_plans(inv: &Inventory) -> Result<Vec<Plan>> {
    let protocols = [Protocol::Gateway, Protocol::Client];
    let mut plans = Vec::new();
    for protocol in protocols {
        plans.push(build_plan_for(inv, protocol)?);
    }
    Ok(plans)
}

pub fn build_plan_for(inv: &Inventory, protocol: Protocol) -> Result<Plan> {
    let inbound_dir = protocol.inbound_direction();
    let outbound_dir = protocol.outbound_direction();

    let mut entries = Vec::new();
    for direction in [inbound_dir, outbound_dir] {
        let wire_name = direction.wire_data_name();
        let wire = inv
            .wire_enums
            .get(wire_name)
            .ok_or_else(|| anyhow!("dispatch: missing wire enum {wire_name}"))?;

        for variant in &wire.variants {
            let category = classify_outer_variant(variant, direction, inv);
            if matches!(category, EntryCategory::Skip) {
                continue;
            }
            let unicast = is_unicast(variant, direction, inv);
            let inner_enum = variant.payload.as_ref().and_then(|p| match p {
                PayloadType::Named(n) => inv.enums.get(n),
                _ => None,
            });
            let inner_variants = inner_enum.map(inner_variant_plans).unwrap_or_default();
            let inner_tag_field = inner_enum.map(|en| en.tag_field.clone());
            entries.push(DispatchEntry {
                outer_disc: rename_camel(&variant.name),
                outer_variant: variant.name.clone(),
                outer_payload: variant.payload.clone(),
                inner_variants,
                inner_tag_field,
                direction,
                category,
                unicast,
            });
        }
    }

    let outbound_requests = inv
        .typed_requests
        .iter()
        .filter(|r| r.direction == outbound_dir)
        .filter_map(|r| build_typed_request(r, inv))
        .collect();
    let inbound_requests = inv
        .typed_requests
        .iter()
        .filter(|r| r.direction == inbound_dir)
        .filter_map(|r| build_typed_request(r, inv))
        .collect();

    Ok(Plan {
        protocol,
        entries,
        outbound_requests,
        inbound_requests,
    })
}

fn inner_variant_plans(en: &EnumDef) -> Vec<InnerVariantPlan> {
    use crate::dispatch::inventory::VariantTag;
    en.variants
        .iter()
        .map(|v| InnerVariantPlan {
            disc: rename_camel(&v.name),
            variant: v.name.clone(),
            payload: v.payload.clone(),
            is_struct: v.is_struct,
            category: match v.tag {
                Some(VariantTag::Event) => Some(EntryCategory::Event),
                Some(VariantTag::Command) => Some(EntryCategory::Command),
                Some(VariantTag::Request) | Some(VariantTag::Response) | None => None,
            },
        })
        .collect()
}

fn build_typed_request(r: &TypedRequest, inv: &Inventory) -> Option<TypedRequestEntry> {
    // Inner enum holding the request variant.
    let request_inner_name = format!(
        "{}{}Msg",
        match r.direction {
            Direction::BridgeToGateway => "BridgeToGateway",
            Direction::GatewayToBridge => "GatewayToBridge",
            Direction::BridgeToClient => "BridgeToClient",
            Direction::ClientToBridge => "ClientToBridge",
        },
        r.surface
    );
    let response_inner_name = format!(
        "{}{}Msg",
        match r.direction.opposite() {
            Direction::BridgeToGateway => "BridgeToGateway",
            Direction::GatewayToBridge => "GatewayToBridge",
            Direction::BridgeToClient => "BridgeToClient",
            Direction::ClientToBridge => "ClientToBridge",
        },
        r.surface
    );
    let inner_tag = inv
        .enums
        .get(&request_inner_name)
        .or_else(|| inv.enums.get(&response_inner_name))
        .map(|e| e.tag_field.clone())
        .unwrap_or_else(|| "event".to_string());
    Some(TypedRequestEntry {
        request: r.request.clone(),
        request_takes_payload: r.request_takes_payload,
        response: r.response.clone(),
        error: r.error.clone(),
        surface: r.surface.clone(),
        surface_disc: rename_camel(&r.surface),
        inner_tag,
        request_disc: rename_camel(&r.request_variant),
        response_disc: rename_camel(&r.response_variant),
        error_disc: r.error_variant.as_deref().map(rename_camel),
    })
}

fn classify_outer_variant(
    variant: &WireVariant,
    direction: Direction,
    inv: &Inventory,
) -> EntryCategory {
    let Some(PayloadType::Named(payload)) = variant.payload.as_ref() else {
        return EntryCategory::Skip;
    };
    let Some(set) = inv.markers.get(payload) else {
        return EntryCategory::Skip;
    };
    if set.has(MarkerKind::Command, direction) {
        EntryCategory::Command
    } else if set.has(MarkerKind::Event, direction) {
        EntryCategory::Event
    } else {
        EntryCategory::Skip
    }
}

fn is_unicast(variant: &WireVariant, direction: Direction, inv: &Inventory) -> bool {
    let Some(PayloadType::Named(payload)) = variant.payload.as_ref() else {
        return false;
    };
    let Some(set) = inv.markers.get(payload) else {
        return false;
    };
    set.has(MarkerKind::Unicast, direction)
}
