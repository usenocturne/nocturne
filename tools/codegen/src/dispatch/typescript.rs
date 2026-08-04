//! TypeScript declaration emitter for the generated shared schema surface.

use std::path::Path;

use anyhow::{Context, Result};

use super::casing::{snake_to_camel, snake_to_pascal};
use crate::dispatch::inventory::*;

pub const TYPESCRIPT_OUTPUT_DIR: &str = "crates/shared/generated/ts";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeScriptSchema {
    pub modules: Vec<TypeScriptModule>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeScriptModule {
    pub family: Family,
    pub items: Vec<TypeScriptItem>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TypeScriptItem {
    Interface(TypeScriptInterface),
    Union(TypeScriptUnion),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeScriptInterface {
    pub name: String,
    pub doc: Vec<String>,
    pub fields: Vec<TypeScriptField>,
    pub index_signature: Option<TypeScriptIndexSignature>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeScriptField {
    pub name: String,
    pub ty: String,
    pub optional: bool,
    pub doc: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeScriptIndexSignature {
    pub ty: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeScriptUnion {
    pub name: String,
    pub doc: Vec<String>,
    pub variants: Vec<String>,
}

pub fn emit_typescript() -> Result<()> {
    emit_typescript_to_dir(TYPESCRIPT_OUTPUT_DIR)
}

pub fn emit_typescript_from_methods_events(methods: &[Method], events: &[Event]) -> Result<()> {
    emit_typescript_methods_events_to_dir(methods, events, TYPESCRIPT_OUTPUT_DIR)
}

pub fn emit_typescript_to_dir(out_dir: impl AsRef<Path>) -> Result<()> {
    emit_typescript_methods_events_to_dir(METHOD_INVENTORY, EVENT_INVENTORY, out_dir)
}

pub fn emit_typescript_from_inventory(inventory: &Inventory) -> Result<()> {
    emit_typescript_inventory_to_dir(inventory, TYPESCRIPT_OUTPUT_DIR)
}

pub fn emit_typescript_inventory_to_dir(
    inventory: &Inventory,
    out_dir: impl AsRef<Path>,
) -> Result<()> {
    let schema = schema_from_inventory(inventory);
    write_schema_to_dir(&schema, out_dir)
}

pub fn emit_typescript_methods_events_to_dir(
    methods: &[Method],
    events: &[Event],
    out_dir: impl AsRef<Path>,
) -> Result<()> {
    let schema = schema_from_methods_events(methods, events);
    write_schema_to_dir(&schema, out_dir)
}

pub fn write_schema_to_dir(schema: &TypeScriptSchema, out_dir: impl AsRef<Path>) -> Result<()> {
    let out_dir = out_dir.as_ref();
    std::fs::create_dir_all(out_dir).with_context(|| format!("create {}", out_dir.display()))?;

    let modules = complete_modules(schema);
    for module in &modules {
        let path = out_dir.join(format!("{}.d.ts", family_file_stem(module.family)));
        std::fs::write(&path, render_family_module(module))
            .with_context(|| format!("write {}", path.display()))?;
    }

    let index_path = out_dir.join("index.d.ts");
    std::fs::write(&index_path, render_index_module())
        .with_context(|| format!("write {}", index_path.display()))?;
    Ok(())
}

pub fn schema_from_inventory(inventory: &Inventory) -> TypeScriptSchema {
    schema_from_methods_events(inventory.methods, inventory.events)
}

pub fn schema_from_methods_events(methods: &[Method], events: &[Event]) -> TypeScriptSchema {
    let mut schema = empty_schema();
    let mut method_variants = empty_family_variants();
    let mut method_response_variants = empty_family_variants();
    let mut event_variants = empty_family_variants();

    for method in methods {
        let base = wire_name_to_pascal(method.name);
        let request_name = format!("{base}Request");
        let response_name = format!("{base}Response");
        let method_message_name = format!("{base}MethodMessage");
        let response_message_name = format!("{base}MethodResponseMessage");

        push_payload_interfaces(
            &mut schema,
            method.family,
            &request_name,
            &method.request,
            vec![
                format!("Request payload for `{}`.", method.name),
                method.request.doc.to_string(),
                format!(
                    "Inventory: `METHOD_INVENTORY` entry `{}` request.",
                    method.name
                ),
            ],
            format!("`METHOD_INVENTORY` entry `{}` request", method.name),
        );
        push_payload_interfaces(
            &mut schema,
            method.family,
            &response_name,
            &method.response,
            vec![
                format!("Response payload for `{}`.", method.name),
                method.response.doc.to_string(),
                format!(
                    "Inventory: `METHOD_INVENTORY` entry `{}` response.",
                    method.name
                ),
            ],
            format!("`METHOD_INVENTORY` entry `{}` response", method.name),
        );

        push_item(
            &mut schema,
            method.family,
            TypeScriptItem::Interface(envelope_interface(
                method_message_name.clone(),
                "method",
                method.name,
                &request_name,
                vec![
                    format!(
                        "Request envelope for `{}` in the `{}` method union.",
                        method.name,
                        family_file_stem(method.family)
                    ),
                    format!("Inventory: `METHOD_INVENTORY` entry `{}`.", method.name),
                ],
            )),
        );
        push_item(
            &mut schema,
            method.family,
            TypeScriptItem::Interface(envelope_interface(
                response_message_name.clone(),
                "method",
                method.name,
                &response_name,
                vec![
                    format!(
                        "Response envelope for `{}` in the `{}` method response union.",
                        method.name,
                        family_file_stem(method.family)
                    ),
                    format!("Inventory: `METHOD_INVENTORY` entry `{}`.", method.name),
                ],
            )),
        );

        variants_for(&mut method_variants, method.family).push(method_message_name);
        variants_for(&mut method_response_variants, method.family).push(response_message_name);
    }

    for event in events {
        let base = wire_name_to_pascal(event.name);
        let payload_name = format!("{base}Event");
        let event_message_name = format!("{base}EventMessage");

        push_payload_interfaces(
            &mut schema,
            event.family,
            &payload_name,
            &event.payload,
            vec![
                format!("Event payload for `{}`.", event.name),
                event.payload.doc.to_string(),
                format!(
                    "Inventory: `EVENT_INVENTORY` entry `{}` payload.",
                    event.name
                ),
            ],
            format!("`EVENT_INVENTORY` entry `{}` payload", event.name),
        );
        push_item(
            &mut schema,
            event.family,
            TypeScriptItem::Interface(envelope_interface(
                event_message_name.clone(),
                "event",
                event.name,
                &payload_name,
                vec![
                    format!(
                        "Event envelope for `{}` in the `{}` event union.",
                        event.name,
                        family_file_stem(event.family)
                    ),
                    format!("Inventory: `EVENT_INVENTORY` entry `{}`.", event.name),
                ],
            )),
        );

        variants_for(&mut event_variants, event.family).push(event_message_name);
    }

    for (family, variants) in method_variants {
        push_item(
            &mut schema,
            family,
            TypeScriptItem::Union(TypeScriptUnion {
                name: format!("{}Method", family_type_name(family)),
                doc: vec![
                    format!(
                        "Discriminated method-request union for the `{}` inventory family.",
                        family_file_stem(family)
                    ),
                    "Inventory: `METHOD_INVENTORY` entries grouped by `Family`.".to_string(),
                ],
                variants,
            }),
        );
    }
    for (family, variants) in method_response_variants {
        push_item(
            &mut schema,
            family,
            TypeScriptItem::Union(TypeScriptUnion {
                name: format!("{}MethodResponse", family_type_name(family)),
                doc: vec![
                    format!(
                        "Discriminated method-response union for the `{}` inventory family.",
                        family_file_stem(family)
                    ),
                    "Inventory: `METHOD_INVENTORY` response entries grouped by `Family`."
                        .to_string(),
                ],
                variants,
            }),
        );
    }
    for (family, variants) in event_variants {
        push_item(
            &mut schema,
            family,
            TypeScriptItem::Union(TypeScriptUnion {
                name: format!("{}Event", family_type_name(family)),
                doc: vec![
                    format!(
                        "Discriminated event union for the `{}` inventory family.",
                        family_file_stem(family)
                    ),
                    "Inventory: `EVENT_INVENTORY` entries grouped by `Family`.".to_string(),
                ],
                variants,
            }),
        );
    }

    sort_schema(&mut schema);
    schema
}

impl TypeScriptItem {
    fn name(&self) -> &str {
        match self {
            TypeScriptItem::Interface(item) => &item.name,
            TypeScriptItem::Union(item) => &item.name,
        }
    }
}

fn push_payload_interfaces(
    schema: &mut TypeScriptSchema,
    family: Family,
    name: &str,
    payload: &Payload,
    doc: Vec<String>,
    inventory_ref: String,
) {
    for field in payload.fields {
        if matches!(field.kind, FieldKind::Object | FieldKind::ObjectArray) {
            push_item(
                schema,
                family,
                TypeScriptItem::Interface(object_field_interface(
                    name,
                    field,
                    family,
                    &inventory_ref,
                )),
            );
        }
    }

    let fields = payload
        .fields
        .iter()
        .map(|field| field_from_inventory(name, field, family))
        .collect();

    push_item(
        schema,
        family,
        TypeScriptItem::Interface(TypeScriptInterface {
            name: name.to_string(),
            doc,
            fields,
            index_signature: None,
        }),
    );
}

fn object_field_interface(
    parent_name: &str,
    field: &Field,
    family: Family,
    inventory_ref: &str,
) -> TypeScriptInterface {
    let field_name = snake_to_camel(field.name);
    TypeScriptInterface {
        name: object_field_interface_name(parent_name, field),
        doc: vec![
            format!("Opaque object shape for `{field_name}` nested under `{parent_name}`."),
            field.doc.to_string(),
            format!("Inventory: field `{}` in {inventory_ref}.", field.name),
        ],
        fields: Vec::new(),
        index_signature: Some(TypeScriptIndexSignature {
            ty: json_value_type_name(family),
        }),
    }
}

fn field_from_inventory(parent_name: &str, field: &Field, family: Family) -> TypeScriptField {
    let name = snake_to_camel(field.name);
    TypeScriptField {
        ty: type_from_field(parent_name, field, family),
        optional: !field.required,
        doc: field_doc(field, &name),
        name,
    }
}

fn type_from_field(parent_name: &str, field: &Field, family: Family) -> String {
    match field.kind {
        FieldKind::Bool => "boolean".to_string(),
        FieldKind::U8
        | FieldKind::U16
        | FieldKind::U32
        | FieldKind::U64
        | FieldKind::I64
        | FieldKind::F64 => "number".to_string(),
        FieldKind::String | FieldKind::BytesBase64 => "string".to_string(),
        FieldKind::StringArray => "string[]".to_string(),
        FieldKind::NumberArray => "number[]".to_string(),
        FieldKind::Object => object_field_interface_name(parent_name, field),
        FieldKind::ObjectArray => format!("{}[]", object_field_interface_name(parent_name, field)),
        FieldKind::Json => json_value_type_name(family),
    }
}

fn field_doc(field: &Field, ts_name: &str) -> String {
    let mut doc = format!(
        "{} Inventory field `{}` emits as `{ts_name}`.",
        field.doc, field.name
    );
    if field.source != field.name {
        doc.push_str(&format!(" Current source key: `{}`.", field.source));
    }
    doc
}

fn envelope_interface(
    name: String,
    tag_field: &str,
    tag_value: &str,
    payload_name: &str,
    doc: Vec<String>,
) -> TypeScriptInterface {
    TypeScriptInterface {
        name,
        doc,
        fields: vec![
            TypeScriptField {
                name: tag_field.to_string(),
                ty: literal_type(tag_value),
                optional: false,
                doc: format!("Discriminator from the inventory `{tag_field}` tag."),
            },
            TypeScriptField {
                name: "data".to_string(),
                ty: payload_name.to_string(),
                optional: false,
                doc: "Payload carried by this inventory variant.".to_string(),
            },
        ],
        index_signature: None,
    }
}

fn empty_schema() -> TypeScriptSchema {
    TypeScriptSchema {
        modules: all_families()
            .into_iter()
            .map(|family| TypeScriptModule {
                family,
                items: Vec::new(),
            })
            .collect(),
    }
}

fn push_item(schema: &mut TypeScriptSchema, family: Family, item: TypeScriptItem) {
    let module = schema
        .modules
        .iter_mut()
        .find(|module| module.family == family)
        .expect("all families initialized");
    module.items.push(item);
}

fn sort_schema(schema: &mut TypeScriptSchema) {
    for module in &mut schema.modules {
        module.items.sort_by(|a, b| a.name().cmp(b.name()));
    }
}

fn empty_family_variants() -> Vec<(Family, Vec<String>)> {
    all_families()
        .into_iter()
        .map(|family| (family, Vec::new()))
        .collect()
}

fn variants_for(variants: &mut [(Family, Vec<String>)], family: Family) -> &mut Vec<String> {
    &mut variants
        .iter_mut()
        .find(|(candidate, _)| *candidate == family)
        .expect("all families initialized")
        .1
}

fn complete_modules(schema: &TypeScriptSchema) -> Vec<TypeScriptModule> {
    all_families()
        .into_iter()
        .map(|family| {
            let mut module = schema
                .modules
                .iter()
                .find(|module| module.family == family)
                .cloned()
                .unwrap_or_else(|| TypeScriptModule {
                    family,
                    items: Vec::new(),
                });
            module.items.sort_by(|a, b| a.name().cmp(b.name()));
            module
        })
        .collect()
}

fn render_index_module() -> String {
    let mut out = generated_header();
    for family in all_families() {
        out.push_str(&format!(
            "export * from \"./{}\";\n",
            family_file_stem(family)
        ));
    }
    out
}

fn render_family_module(module: &TypeScriptModule) -> String {
    let mut out = generated_header();
    if module.family == Family::Iap2 {
        out.push_str("// iap2 family: not emitted, daemon-internal only.\n");
        return out;
    }
    let json_name = json_value_type_name(module.family);
    out.push_str(&format!(
    "export type {json_name} = string | number | boolean | null | {json_name}[] | {{ [key: string]: {json_name} }};\n\n"
  ));

    for item in &module.items {
        match item {
            TypeScriptItem::Interface(item) => render_interface(&mut out, item),
            TypeScriptItem::Union(item) => render_union(&mut out, item),
        }
        out.push('\n');
    }

    out
}

fn render_interface(out: &mut String, item: &TypeScriptInterface) {
    push_jsdoc(out, 0, &item.doc);
    out.push_str(&format!("export interface {} {{\n", item.name));
    for field in &item.fields {
        push_jsdoc(out, 2, std::slice::from_ref(&field.doc));
        let optional = if field.optional { "?" } else { "" };
        out.push_str(&format!("  {}{}: {};\n", field.name, optional, field.ty));
    }
    if let Some(index_signature) = &item.index_signature {
        out.push_str(&format!("  [key: string]: {};\n", index_signature.ty));
    }
    out.push_str("}\n");
}

fn render_union(out: &mut String, item: &TypeScriptUnion) {
    push_jsdoc(out, 0, &item.doc);
    if item.variants.is_empty() {
        out.push_str(&format!("export type {} = never;\n", item.name));
        return;
    }
    out.push_str(&format!("export type {} =\n", item.name));
    for variant in &item.variants {
        out.push_str(&format!("  | {variant}\n"));
    }
    out.push_str(";\n");
}

fn push_jsdoc(out: &mut String, indent: usize, lines: &[String]) {
    let pad = " ".repeat(indent);
    out.push_str(&format!("{pad}/**\n"));
    for line in lines {
        let mut emitted = false;
        for subline in line.lines() {
            out.push_str(&format!("{pad} * {}\n", sanitize_doc_line(subline)));
            emitted = true;
        }
        if !emitted {
            out.push_str(&format!("{pad} *\n"));
        }
    }
    out.push_str(&format!("{pad} */\n"));
}

fn sanitize_doc_line(line: &str) -> String {
    line.replace("*/", "* /")
}

fn object_field_interface_name(parent_name: &str, field: &Field) -> String {
    format!("{parent_name}{}", snake_to_pascal(field.name))
}

fn json_value_type_name(family: Family) -> String {
    format!("{}JsonValue", family_type_name(family))
}

fn literal_type(value: &str) -> String {
    format!("{value:?}")
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

#[cfg(test)]
mod tests {
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
    const BATTERY_EVENT_FIELDS: &[Field] = &[
        Field {
            name: "is_charging",
            source: "isCharging",
            kind: FieldKind::Bool,
            required: true,
            doc: "Whether external power is present.",
        },
        Field {
            name: "device_info",
            source: "deviceInfo",
            kind: FieldKind::Object,
            required: false,
            doc: "Device metadata object.",
        },
    ];
    const BATTERY_EVENT_PAYLOAD: Payload = Payload {
        fields: BATTERY_EVENT_FIELDS,
        example: r#"{"is_charging":true}"#,
        doc: "Battery state update.",
    };

    #[test]
    fn emits_declaration_interfaces_with_jsdoc_and_camel_case_fields() {
        let method = Method {
            name: "device.set_volume",
            family: Family::Device,
            source: "device.setVolume",
            aliases: &[],
            request: SET_VOLUME_REQUEST,
            response: SET_VOLUME_RESPONSE,
            doc: "Set playback volume.",
        };
        let event = Event {
            name: "battery_changed",
            family: Family::Device,
            source: "batteryChanged",
            aliases: &[],
            payload: BATTERY_EVENT_PAYLOAD,
            iap2_csm: None,
            doc: "Battery state changed.",
        };
        let schema = schema_from_methods_events(&[method], &[event]);
        let module = schema
            .modules
            .iter()
            .find(|module| module.family == Family::Device)
            .expect("device module emitted");

        let out = render_family_module(module);

        assert!(out.contains("export type DeviceJsonValue = string | number | boolean | null"));
        assert!(out.contains(" * Request payload for `device.set_volume`."));
        assert!(
            out.contains(" * Inventory: `METHOD_INVENTORY` entry `device.set_volume` request.")
        );
        assert!(out.contains("export interface DeviceSetVolumeRequest"));
        assert!(out.contains("volumePercent: number;"));
        assert!(out.contains("Current source key: `volumePercent`."));
        assert!(out.contains("export interface DeviceSetVolumeMethodMessage"));
        assert!(out.contains("method: \"device.set_volume\";"));
        assert!(out.contains("export interface BatteryChangedEvent"));
        assert!(out.contains("isCharging: boolean;"));
        assert!(out.contains("deviceInfo?: BatteryChangedEventDeviceInfo;"));
        assert!(out.contains("export interface BatteryChangedEventDeviceInfo"));
        assert!(out.contains("[key: string]: DeviceJsonValue;"));
        assert!(out.contains("export type DeviceEvent ="));
        assert!(out.contains("| BatteryChangedEventMessage"));
    }

    #[test]
    fn index_re_exports_each_family_declaration_file() {
        let out = render_index_module();

        assert!(out.contains("export * from \"./device\";"));
        assert!(out.contains("export * from \"./media_control\";"));
        assert!(out.contains("export * from \"./bt_only\";"));
    }
}
