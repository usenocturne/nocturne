//! Swift wire-type emitter for the generated shared schema surface.

use std::path::Path;

use anyhow::{Context, Result};

use super::casing::{snake_to_camel, snake_to_pascal};
use crate::dispatch::inventory::*;

pub const SWIFT_OUTPUT_DIR: &str = "crates/shared/generated/swift";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SwiftSchema {
    pub modules: Vec<SwiftModule>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SwiftModule {
    pub family: Family,
    pub items: Vec<SwiftItem>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SwiftItem {
    Struct(SwiftStruct),
    Enum(SwiftEnum),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SwiftStruct {
    pub name: String,
    pub fields: Vec<SwiftField>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SwiftField {
    pub name: String,
    pub wire_name: String,
    pub ty: SwiftFieldType,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SwiftEnum {
    pub name: String,
    pub raw_string: bool,
    pub cases: Vec<SwiftEnumCase>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SwiftEnumCase {
    pub name: String,
    pub wire_value: String,
    pub payload: Option<SwiftFieldType>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SwiftFieldType {
    Bool,
    UInt8,
    UInt16,
    UInt32,
    UInt64,
    Int64,
    Double,
    String,
    Data,
    Value,
    Named(String),
    Array(Box<SwiftFieldType>),
    Optional(Box<SwiftFieldType>),
}

pub fn emit_swift() -> Result<()> {
    emit_swift_to_dir(SWIFT_OUTPUT_DIR)
}

pub fn emit_swift_from_methods_events(methods: &[Method], events: &[Event]) -> Result<()> {
    emit_swift_methods_events_to_dir(methods, events, SWIFT_OUTPUT_DIR)
}

pub fn emit_swift_to_dir(out_dir: impl AsRef<Path>) -> Result<()> {
    emit_swift_methods_events_to_dir(METHOD_INVENTORY, EVENT_INVENTORY, out_dir)
}

pub fn emit_swift_from_inventory(inventory: &Inventory) -> Result<()> {
    emit_swift_inventory_to_dir(inventory, SWIFT_OUTPUT_DIR)
}

pub fn emit_swift_inventory_to_dir(inventory: &Inventory, out_dir: impl AsRef<Path>) -> Result<()> {
    let schema = schema_from_inventory(inventory);
    write_schema_to_dir(&schema, out_dir)
}

pub fn emit_swift_methods_events_to_dir(
    methods: &[Method],
    events: &[Event],
    out_dir: impl AsRef<Path>,
) -> Result<()> {
    let schema = schema_from_methods_events(methods, events);
    write_schema_to_dir(&schema, out_dir)
}

pub fn write_schema_to_dir(schema: &SwiftSchema, out_dir: impl AsRef<Path>) -> Result<()> {
    let out_dir = out_dir.as_ref();
    std::fs::create_dir_all(out_dir).with_context(|| format!("create {}", out_dir.display()))?;

    let modules = complete_modules(schema);
    for module in &modules {
        let path = out_dir.join(format!("{}.swift", family_file_stem(module.family)));
        std::fs::write(&path, render_family_module(module))
            .with_context(|| format!("write {}", path.display()))?;
    }

    let generated_path = out_dir.join("Generated.swift");
    std::fs::write(&generated_path, render_generated_file())
        .with_context(|| format!("write {}", generated_path.display()))?;
    Ok(())
}

pub fn schema_from_inventory(inventory: &Inventory) -> SwiftSchema {
    let mut schema = schema_from_methods_events(inventory.methods, inventory.events);
    let mut enums: Vec<&EnumDef> = Vec::new();
    enums.extend(inventory.wire_enums.values());
    enums.extend(inventory.enums.values());
    enums.sort_by(|a, b| a.name.cmp(&b.name));

    for def in enums {
        let family = infer_family(&def.name);
        push_item(
            &mut schema,
            family,
            SwiftItem::Enum(enum_from_inventory(def)),
        );
    }

    sort_schema(&mut schema);
    schema
}

pub fn schema_from_methods_events(methods: &[Method], events: &[Event]) -> SwiftSchema {
    let mut schema = empty_schema();
    let mut method_cases = empty_family_cases();
    let mut event_cases = empty_family_cases();

    for method in methods {
        let base = wire_name_to_pascal(method.name);
        let request_name = format!("{base}Request");
        let response_name = format!("{base}Response");

        push_item(
            &mut schema,
            method.family,
            SwiftItem::Struct(struct_from_payload(request_name.clone(), &method.request)),
        );
        push_item(
            &mut schema,
            method.family,
            SwiftItem::Struct(struct_from_payload(response_name, &method.response)),
        );
        cases_for(&mut method_cases, method.family).push(SwiftEnumCase {
            name: wire_name_to_camel(method.name),
            wire_value: method.name.to_string(),
            payload: Some(SwiftFieldType::Named(request_name)),
        });
    }

    for event in events {
        let base = wire_name_to_pascal(event.name);
        let payload_name = format!("{base}Event");

        push_item(
            &mut schema,
            event.family,
            SwiftItem::Struct(struct_from_payload(payload_name.clone(), &event.payload)),
        );
        cases_for(&mut event_cases, event.family).push(SwiftEnumCase {
            name: wire_name_to_camel(event.name),
            wire_value: event.name.to_string(),
            payload: Some(SwiftFieldType::Named(payload_name)),
        });
    }

    for (family, cases) in method_cases {
        if cases.is_empty() {
            continue;
        }
        push_item(
            &mut schema,
            family,
            SwiftItem::Enum(SwiftEnum {
                name: format!("{}Method", family_type_name(family)),
                raw_string: false,
                cases,
            }),
        );
    }

    for (family, cases) in event_cases {
        if cases.is_empty() {
            continue;
        }
        push_item(
            &mut schema,
            family,
            SwiftItem::Enum(SwiftEnum {
                name: format!("{}Event", family_type_name(family)),
                raw_string: false,
                cases,
            }),
        );
    }

    sort_schema(&mut schema);
    schema
}

impl SwiftItem {
    fn name(&self) -> &str {
        match self {
            SwiftItem::Struct(item) => &item.name,
            SwiftItem::Enum(item) => &item.name,
        }
    }
}

impl SwiftFieldType {
    fn swift(&self) -> String {
        match self {
            Self::Bool => "Bool".to_string(),
            Self::UInt8 => "UInt8".to_string(),
            Self::UInt16 => "UInt16".to_string(),
            Self::UInt32 => "UInt32".to_string(),
            Self::UInt64 => "UInt64".to_string(),
            Self::Int64 => "Int64".to_string(),
            Self::Double => "Double".to_string(),
            Self::String => "String".to_string(),
            Self::Data => "Data".to_string(),
            Self::Value => "Value".to_string(),
            Self::Named(name) => name.clone(),
            Self::Array(inner) => format!("[{}]", inner.swift()),
            Self::Optional(inner) => format!("{}?", inner.swift()),
        }
    }
}

fn enum_from_inventory(def: &EnumDef) -> SwiftEnum {
    let raw_string = def
        .variants
        .iter()
        .all(|variant| variant.payload.is_none() && !variant.is_struct);
    SwiftEnum {
        name: def.name.clone(),
        raw_string,
        cases: def
            .variants
            .iter()
            .map(|variant| SwiftEnumCase {
                name: lower_first(&variant.name),
                wire_value: lower_first(&variant.name),
                payload: variant.payload.as_ref().map(type_from_payload),
            })
            .collect(),
    }
}

fn type_from_payload(payload: &PayloadType) -> SwiftFieldType {
    match payload {
        PayloadType::Named(name) => SwiftFieldType::Named(match name.as_str() {
            "Notification" => "NocturneSchema.Notification".to_string(),
            _ => name.clone(),
        }),
        PayloadType::Bytes => SwiftFieldType::Data,
        PayloadType::JsonValue => SwiftFieldType::Value,
        PayloadType::StringScalar => SwiftFieldType::String,
    }
}

fn struct_from_payload(name: String, payload: &Payload) -> SwiftStruct {
    SwiftStruct {
        name,
        fields: payload
            .fields
            .iter()
            .map(|field| SwiftField {
                name: snake_to_camel(field.name),
                wire_name: field.name.to_string(),
                ty: type_from_field(field),
            })
            .collect(),
    }
}

fn type_from_field(field: &Field) -> SwiftFieldType {
    let ty = match field.kind {
        FieldKind::Bool => SwiftFieldType::Bool,
        FieldKind::U8 => SwiftFieldType::UInt8,
        FieldKind::U16 => SwiftFieldType::UInt16,
        FieldKind::U32 => SwiftFieldType::UInt32,
        FieldKind::U64 => SwiftFieldType::UInt64,
        FieldKind::I64 => SwiftFieldType::Int64,
        FieldKind::F64 => SwiftFieldType::Double,
        FieldKind::String => SwiftFieldType::String,
        FieldKind::StringArray => SwiftFieldType::Array(Box::new(SwiftFieldType::String)),
        FieldKind::NumberArray => SwiftFieldType::Array(Box::new(SwiftFieldType::Double)),
        FieldKind::Object | FieldKind::Json => SwiftFieldType::Value,
        FieldKind::ObjectArray => SwiftFieldType::Array(Box::new(SwiftFieldType::Value)),
        FieldKind::BytesBase64 => SwiftFieldType::Data,
    };

    if field.required {
        ty
    } else {
        SwiftFieldType::Optional(Box::new(ty))
    }
}

fn empty_schema() -> SwiftSchema {
    SwiftSchema {
        modules: all_families()
            .into_iter()
            .map(|family| SwiftModule {
                family,
                items: Vec::new(),
            })
            .collect(),
    }
}

fn push_item(schema: &mut SwiftSchema, family: Family, item: SwiftItem) {
    let module = schema
        .modules
        .iter_mut()
        .find(|module| module.family == family)
        .expect("all families initialized");
    module.items.push(item);
}

fn sort_schema(schema: &mut SwiftSchema) {
    for module in &mut schema.modules {
        module.items.sort_by(|a, b| a.name().cmp(b.name()));
    }
}

fn empty_family_cases() -> Vec<(Family, Vec<SwiftEnumCase>)> {
    all_families()
        .into_iter()
        .map(|family| (family, Vec::new()))
        .collect()
}

fn cases_for(
    cases: &mut [(Family, Vec<SwiftEnumCase>)],
    family: Family,
) -> &mut Vec<SwiftEnumCase> {
    &mut cases
        .iter_mut()
        .find(|(candidate, _)| *candidate == family)
        .expect("all families initialized")
        .1
}

fn complete_modules(schema: &SwiftSchema) -> Vec<SwiftModule> {
    all_families()
        .into_iter()
        .map(|family| {
            let mut module = schema
                .modules
                .iter()
                .find(|module| module.family == family)
                .cloned()
                .unwrap_or_else(|| SwiftModule {
                    family,
                    items: Vec::new(),
                });
            module.items.sort_by(|a, b| a.name().cmp(b.name()));
            module
        })
        .collect()
}

fn render_generated_file() -> String {
    let mut out = generated_header();
    out.push_str("import Foundation\n\n");
    out.push_str("// Public declarations live in the per-family Swift files in this module.\n");
    out
}

fn render_family_module(module: &SwiftModule) -> String {
    let mut out = generated_header();
    if module.family == Family::Iap2 {
        out.push_str("// iap2 family: not emitted, daemon-internal only.\n");
        return out;
    }
    out.push_str("import Foundation\n\n");

    for item in &module.items {
        match item {
            SwiftItem::Struct(item) => render_struct(&mut out, item),
            SwiftItem::Enum(item) => render_enum(&mut out, item),
        }
        out.push('\n');
    }

    out
}

fn render_struct(out: &mut String, item: &SwiftStruct) {
    out.push_str(&format!(
        "public struct {}: Codable, Sendable {{\n",
        item.name
    ));
    if item.fields.is_empty() {
        out.push_str("  public init() {}\n");
        out.push_str("}\n");
        return;
    }

    for field in &item.fields {
        out.push_str(&format!(
            "  public let {}: {}\n",
            swift_ident(&field.name),
            field.ty.swift()
        ));
    }
    out.push('\n');

    out.push_str("  public init(\n");
    for (index, field) in item.fields.iter().enumerate() {
        let trailing = if index + 1 == item.fields.len() {
            ""
        } else {
            ","
        };
        out.push_str(&format!(
            "    {}: {}{}\n",
            swift_ident(&field.name),
            field.ty.swift(),
            trailing
        ));
    }
    out.push_str("  ) {\n");
    for field in &item.fields {
        let ident = swift_ident(&field.name);
        out.push_str(&format!("    self.{ident} = {ident}\n"));
    }
    out.push_str("  }\n\n");

    out.push_str("  private enum CodingKeys: String, CodingKey {\n");
    for field in &item.fields {
        out.push_str(&format!(
            "    case {} = {:?}\n",
            swift_ident(&field.name),
            field.wire_name
        ));
    }
    out.push_str("  }\n");
    out.push_str("}\n");
}

fn render_enum(out: &mut String, item: &SwiftEnum) {
    if item.raw_string {
        out.push_str(&format!(
            "public enum {}: String, Codable, Sendable {{\n",
            item.name
        ));
    } else {
        out.push_str(&format!(
            "public enum {}: Codable, Sendable {{\n",
            item.name
        ));
    }

    for case in &item.cases {
        let name = swift_ident(&case.name);
        if item.raw_string {
            out.push_str(&format!("  case {name} = {:?}\n", case.wire_value));
        } else if let Some(payload) = &case.payload {
            out.push_str(&format!("  case {name}({})\n", payload.swift()));
        } else {
            out.push_str(&format!("  case {name}\n"));
        }
    }
    out.push_str("}\n");
}

fn generated_header() -> String {
    "// THIS FILE IS GENERATED BY tools/codegen. Do not edit by hand.\n// Re-generate with `just codegen`.\n\n".to_string()
}

fn all_families() -> [Family; 10] {
    [
        Family::Bluetooth,
        Family::Device,
        Family::Audio,
        Family::MediaControl,
        Family::Phone,
        Family::Spotify,
        Family::Voice,
        Family::BtOnly,
        Family::Ota,
        Family::Iap2,
    ]
}

fn family_file_stem(family: Family) -> &'static str {
    match family {
        Family::Bluetooth => "bluetooth",
        Family::Device => "device",
        Family::Audio => "audio",
        Family::MediaControl => "media_control",
        Family::Phone => "phone",
        Family::Spotify => "spotify",
        Family::Voice => "voice",
        Family::BtOnly => "bt_only",
        Family::Ota => "ota",
        Family::Iap2 => "iap2",
    }
}

fn family_type_name(family: Family) -> &'static str {
    match family {
        Family::Bluetooth => "Bluetooth",
        Family::Device => "Device",
        Family::Audio => "Audio",
        Family::MediaControl => "MediaControl",
        Family::Phone => "Phone",
        Family::Spotify => "Spotify",
        Family::Voice => "Voice",
        Family::BtOnly => "BtOnly",
        Family::Ota => "Ota",
        Family::Iap2 => "Iap2",
    }
}

fn wire_name_to_pascal(name: &str) -> String {
    let mut normalized = String::with_capacity(name.len());
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            normalized.push(ch.to_ascii_lowercase());
        } else {
            normalized.push('_');
        }
    }
    snake_to_pascal(&normalized)
}

fn wire_name_to_camel(name: &str) -> String {
    let mut normalized = String::with_capacity(name.len());
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            normalized.push(ch.to_ascii_lowercase());
        } else {
            normalized.push('_');
        }
    }
    snake_to_camel(&normalized)
}

fn lower_first(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    if let Some(first) = chars.next() {
        out.extend(first.to_lowercase());
    }
    out.push_str(chars.as_str());
    out
}

fn infer_family(name: &str) -> Family {
    let lower = name.to_ascii_lowercase();
    if lower.contains("bluetooth") {
        Family::Bluetooth
    } else if lower.contains("spotify") {
        Family::Spotify
    } else if lower.contains("audio") {
        Family::Audio
    } else if lower.contains("voice")
        || lower.contains("wakeword")
        || lower.contains("transcription")
    {
        Family::Voice
    } else if lower.contains("media") || lower.contains("playback") {
        Family::MediaControl
    } else if lower.contains("ota") || lower.contains("chunk") || lower.contains("range") {
        Family::Ota
    } else if lower.contains("gateway") || lower.contains("bridge") || lower.contains("daemon") {
        Family::BtOnly
    } else {
        Family::Device
    }
}

fn swift_ident(s: &str) -> String {
    match s {
        "associatedtype" | "class" | "deinit" | "enum" | "extension" | "fileprivate" | "func"
        | "import" | "init" | "inout" | "internal" | "let" | "open" | "operator" | "private"
        | "protocol" | "public" | "rethrows" | "static" | "struct" | "subscript" | "typealias"
        | "var" | "break" | "case" | "continue" | "default" | "defer" | "do" | "else"
        | "fallthrough" | "for" | "guard" | "if" | "in" | "repeat" | "return" | "switch"
        | "where" | "while" | "as" | "Any" | "catch" | "false" | "is" | "nil" | "super"
        | "self" | "Self" | "throw" | "throws" | "true" | "try" | "Type" | "Protocol" => {
            format!("`{s}`")
        }
        _ => s.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeSet, HashMap};

    use super::*;

    const SET_VOLUME_FIELDS: &[Field] = &[Field {
        name: "volume_percent",
        source: "volumePercent",
        kind: FieldKind::U8,
        required: true,
        doc: "Requested volume percentage.",
    }];
    const SET_VOLUME_REQUEST: Payload = Payload {
        fields: SET_VOLUME_FIELDS,
        example: r#"{"volume_percent":42}"#,
        doc: "Set volume request.",
    };
    const SET_VOLUME_RESPONSE_FIELDS: &[Field] = &[Field {
        name: "success",
        source: "success",
        kind: FieldKind::Bool,
        required: true,
        doc: "Whether volume changed.",
    }];
    const SET_VOLUME_RESPONSE: Payload = Payload {
        fields: SET_VOLUME_RESPONSE_FIELDS,
        example: r#"{"success":true}"#,
        doc: "Set volume response.",
    };
    const BATTERY_EVENT_FIELDS: &[Field] = &[Field {
        name: "is_charging",
        source: "isCharging",
        kind: FieldKind::Bool,
        required: true,
        doc: "Whether external power is present.",
    }];
    const BATTERY_EVENT_PAYLOAD: Payload = Payload {
        fields: BATTERY_EVENT_FIELDS,
        example: r#"{"is_charging":true}"#,
        doc: "Battery state update.",
    };

    const SET_VOLUME_METHOD: Method = Method {
        name: "set_volume",
        family: Family::Device,
        source: "setVolume",
        aliases: &[],
        request: SET_VOLUME_REQUEST,
        response: SET_VOLUME_RESPONSE,
        doc: "Set playback volume.",
    };
    const BATTERY_CHANGED_EVENT: Event = Event {
        name: "battery_changed",
        family: Family::Device,
        source: "batteryChanged",
        aliases: &[],
        payload: BATTERY_EVENT_PAYLOAD,
        iap2_csm: None,
        doc: "Battery state changed.",
    };

    #[test]
    fn emits_structs_with_camel_case_fields_and_coding_keys() {
        let schema = schema_from_methods_events(&[SET_VOLUME_METHOD], &[BATTERY_CHANGED_EVENT]);
        let module = schema
            .modules
            .iter()
            .find(|module| module.family == Family::Device)
            .expect("device module emitted");

        let out = render_family_module(module);

        assert!(out.contains("import Foundation"));
        assert!(out.contains("public struct SetVolumeRequest: Codable, Sendable"));
        assert!(out.contains("public let volumePercent: UInt8"));
        assert!(out.contains("public init(\n    volumePercent: UInt8\n  )"));
        assert!(out.contains("self.volumePercent = volumePercent"));
        assert!(out.contains("private enum CodingKeys: String, CodingKey"));
        assert!(out.contains("case volumePercent = \"volume_percent\""));
        assert!(out.contains("public let isCharging: Bool"));
        assert!(out.contains("case isCharging = \"is_charging\""));
        assert!(out.contains("public enum DeviceMethod: Codable, Sendable"));
        assert!(out.contains("case setVolume(SetVolumeRequest)"));
        assert!(out.contains("public enum DeviceEvent: Codable, Sendable"));
        assert!(out.contains("case batteryChanged(BatteryChangedEvent)"));
    }

    #[test]
    fn inventory_schema_keeps_common_enums_and_method_event_payloads() {
        let mut enums = HashMap::new();
        enums.insert(
            "DeviceMode".to_string(),
            EnumDef {
                name: "DeviceMode".to_string(),
                tag_field: "type".to_string(),
                variants: vec![WireVariant {
                    name: "Ready".to_string(),
                    payload: None,
                    is_struct: false,
                    tag: None,
                }],
            },
        );
        let inventory = Inventory {
            wire_enums: HashMap::new(),
            enums,
            markers: HashMap::new(),
            typed_requests: Vec::new(),
            methods: Box::leak(vec![SET_VOLUME_METHOD].into_boxed_slice()),
            events: Box::leak(vec![BATTERY_CHANGED_EVENT].into_boxed_slice()),
            csms: &[],
            uuid_field_names: BTreeSet::new(),
        };
        let schema = schema_from_inventory(&inventory);
        let module = schema
            .modules
            .iter()
            .find(|module| module.family == Family::Device)
            .expect("device module emitted");

        let out = render_family_module(module);

        assert!(out.contains("public enum DeviceMode: String, Codable, Sendable"));
        assert!(out.contains("case ready = \"ready\""));
        assert!(out.contains("public struct SetVolumeRequest: Codable, Sendable"));
        assert!(out.contains("public struct SetVolumeResponse: Codable, Sendable"));
        assert!(out.contains("public struct BatteryChangedEvent: Codable, Sendable"));
        assert!(out.contains("case setVolume(SetVolumeRequest)"));
        assert!(out.contains("case batteryChanged(BatteryChangedEvent)"));
    }

    #[test]
    fn emits_raw_string_enum_when_cases_have_no_payload() {
        let item = SwiftEnum {
            name: "Mode".to_string(),
            raw_string: true,
            cases: vec![SwiftEnumCase {
                name: "repeat".to_string(),
                wire_value: "repeat".to_string(),
                payload: None,
            }],
        };
        let mut out = String::new();

        render_enum(&mut out, &item);

        assert!(out.contains("public enum Mode: String, Codable, Sendable"));
        assert!(out.contains("case `repeat` = \"repeat\""));
    }

    #[test]
    fn generated_file_documents_per_family_swift_files() {
        let out = render_generated_file();

        assert!(out.contains("import Foundation"));
        assert!(out.contains("per-family Swift files"));
    }
}
