//! Rust wire-type emitter for the generated shared schema surface.

use std::path::Path;

use anyhow::{Context, Result};

use super::casing::snake_to_pascal;
use crate::dispatch::inventory::*;

pub const RUST_OUTPUT_DIR: &str = "crates/shared/generated/rust";
pub const IAP2_CSM_OUTPUT: &str = "crates/iap2/src/csm/generated.rs";

const DERIVE_ATTR: &str = "Serialize, Deserialize, Debug, Clone, PartialEq";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RustSchema {
    pub modules: Vec<RustModule>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RustModule {
    pub family: Family,
    pub items: Vec<RustItem>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RustItem {
    Struct(RustStruct),
    Enum(RustEnum),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RustStruct {
    pub name: String,
    pub fields: Vec<RustField>,
    pub iap2_csm: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RustField {
    pub name: String,
    pub ty: RustFieldType,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RustEnum {
    pub name: String,
    pub tag_field: Option<String>,
    pub variants: Vec<RustEnumVariant>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RustEnumVariant {
    pub name: String,
    pub payload: Option<RustFieldType>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RustFieldType {
    Bool,
    I8,
    U8,
    I16,
    U16,
    U32,
    U64,
    I32,
    I64,
    F32,
    F64,
    String,
    Bytes,
    JsonValue,
    Named(String),
    Vec(Box<RustFieldType>),
    Option(Box<RustFieldType>),
}

pub fn emit_rust() -> Result<()> {
    emit_rust_to_dir(RUST_OUTPUT_DIR)
}

pub fn emit_iap2_csm_to_file(csms: &[Csm], out_file: impl AsRef<Path>) -> Result<()> {
    let out_file = out_file.as_ref();
    if let Some(parent) = out_file.parent() {
        std::fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;
    }
    std::fs::write(out_file, render_iap2_csm_module(csms))
        .with_context(|| format!("write {}", out_file.display()))?;
    Ok(())
}

pub fn emit_rust_from_methods_events(methods: &[Method], events: &[Event]) -> Result<()> {
    emit_rust_methods_events_to_dir(methods, events, RUST_OUTPUT_DIR)
}

pub fn emit_rust_to_dir(out_dir: impl AsRef<Path>) -> Result<()> {
    emit_rust_methods_events_to_dir(METHOD_INVENTORY, EVENT_INVENTORY, out_dir)
}

pub fn emit_rust_from_inventory(inventory: &Inventory) -> Result<()> {
    emit_rust_inventory_to_dir(inventory, RUST_OUTPUT_DIR)
}

pub fn emit_rust_inventory_to_dir(inventory: &Inventory, out_dir: impl AsRef<Path>) -> Result<()> {
    let schema = schema_from_rust_inventory(inventory);
    write_schema_to_dir(&schema, out_dir)
}

pub fn emit_rust_methods_events_to_dir(
    methods: &[Method],
    events: &[Event],
    out_dir: impl AsRef<Path>,
) -> Result<()> {
    let schema = schema_from_methods_events(methods, events);
    write_schema_to_dir(&schema, out_dir)
}

pub fn write_schema_to_dir(schema: &RustSchema, out_dir: impl AsRef<Path>) -> Result<()> {
    let out_dir = out_dir.as_ref();
    std::fs::create_dir_all(out_dir).with_context(|| format!("create {}", out_dir.display()))?;

    let modules = complete_modules(schema);
    for module in &modules {
        let path = out_dir.join(format!("{}.rs", family_file_stem(module.family)));
        std::fs::write(&path, render_family_module(module))
            .with_context(|| format!("write {}", path.display()))?;
    }

    let mod_path = out_dir.join("mod.rs");
    std::fs::write(&mod_path, render_root_module(&modules))
        .with_context(|| format!("write {}", mod_path.display()))?;
    Ok(())
}

pub fn schema_from_inventory(inventory: &Inventory) -> RustSchema {
    let mut schema = empty_schema();

    let mut enums: Vec<&EnumDef> = Vec::new();
    enums.extend(inventory.wire_enums.values());
    enums.extend(inventory.enums.values());
    enums.sort_by(|a, b| a.name.cmp(&b.name));

    for def in enums {
        let family = infer_family(&def.name);
        push_item(
            &mut schema,
            family,
            RustItem::Enum(enum_from_inventory(def)),
        );
    }

    sort_schema(&mut schema);

    schema
}

pub fn schema_from_rust_inventory(inventory: &Inventory) -> RustSchema {
    let mut schema = schema_from_methods_events(inventory.methods, inventory.events);

    for csm in inventory.csms {
        push_item(
            &mut schema,
            Family::Iap2,
            RustItem::Struct(struct_from_csm(csm)),
        );
    }

    sort_schema(&mut schema);

    schema
}

pub fn schema_from_methods_events(methods: &[Method], events: &[Event]) -> RustSchema {
    let mut schema = empty_schema();
    let mut method_variants = empty_family_variants();
    let mut event_variants = empty_family_variants();

    for method in methods {
        let base = wire_name_to_pascal(method.name);
        let request_name = format!("{base}Request");
        let response_name = format!("{base}Response");

        push_item(
            &mut schema,
            method.family,
            RustItem::Struct(struct_from_payload(
                request_name.clone(),
                &method.request,
                None,
            )),
        );
        push_item(
            &mut schema,
            method.family,
            RustItem::Struct(struct_from_payload(response_name, &method.response, None)),
        );
        variants_for(&mut method_variants, method.family).push(RustEnumVariant {
            name: base,
            payload: Some(RustFieldType::Named(request_name)),
        });
    }

    for event in events {
        let base = wire_name_to_pascal(event.name);
        let payload_name = format!("{base}Event");

        push_item(
            &mut schema,
            event.family,
            RustItem::Struct(struct_from_payload(
                payload_name.clone(),
                &event.payload,
                event.iap2_csm,
            )),
        );
        variants_for(&mut event_variants, event.family).push(RustEnumVariant {
            name: base,
            payload: Some(RustFieldType::Named(payload_name)),
        });
    }

    for (family, variants) in method_variants {
        if variants.is_empty() {
            continue;
        }
        push_item(
            &mut schema,
            family,
            RustItem::Enum(RustEnum {
                name: format!("{}Method", family_type_name(family)),
                tag_field: Some("method".to_string()),
                variants,
            }),
        );
    }

    for (family, variants) in event_variants {
        if variants.is_empty() {
            continue;
        }
        push_item(
            &mut schema,
            family,
            RustItem::Enum(RustEnum {
                name: format!("{}Event", family_type_name(family)),
                tag_field: Some("event".to_string()),
                variants,
            }),
        );
    }

    sort_schema(&mut schema);

    schema
}

impl RustItem {
    fn name(&self) -> &str {
        match self {
            RustItem::Struct(item) => &item.name,
            RustItem::Enum(item) => &item.name,
        }
    }
}

impl RustFieldType {
    fn rust(&self) -> String {
        match self {
            Self::Bool => "bool".to_string(),
            Self::I8 => "i8".to_string(),
            Self::U8 => "u8".to_string(),
            Self::I16 => "i16".to_string(),
            Self::U16 => "u16".to_string(),
            Self::U32 => "u32".to_string(),
            Self::U64 => "u64".to_string(),
            Self::I32 => "i32".to_string(),
            Self::I64 => "i64".to_string(),
            Self::F32 => "f32".to_string(),
            Self::F64 => "f64".to_string(),
            Self::String => "String".to_string(),
            Self::Bytes => "Vec<u8>".to_string(),
            Self::JsonValue => "serde_json::Value".to_string(),
            Self::Named(name) => name.clone(),
            Self::Vec(inner) => format!("Vec<{}>", inner.rust()),
            Self::Option(inner) => format!("Option<{}>", inner.rust()),
        }
    }
}

impl RustModule {
    fn uses_bytes_crate(&self) -> bool {
        self.items.iter().any(|item| match item {
            RustItem::Struct(item) => item.fields.iter().any(|field| field.ty.uses_bytes_crate()),
            RustItem::Enum(item) => item.variants.iter().any(|variant| {
                variant
                    .payload
                    .as_ref()
                    .is_some_and(RustFieldType::uses_bytes_crate)
            }),
        })
    }
}

impl RustFieldType {
    fn uses_bytes_crate(&self) -> bool {
        match self {
            Self::Named(name) => name == "Bytes",
            Self::Vec(inner) | Self::Option(inner) => inner.uses_bytes_crate(),
            Self::Bytes => false,
            Self::Bool
            | Self::I8
            | Self::U8
            | Self::I16
            | Self::U16
            | Self::U32
            | Self::U64
            | Self::I32
            | Self::I64
            | Self::F32
            | Self::F64
            | Self::String
            | Self::JsonValue => false,
        }
    }
}

fn enum_from_inventory(def: &EnumDef) -> RustEnum {
    RustEnum {
        name: def.name.clone(),
        tag_field: Some(def.tag_field.clone()),
        variants: def
            .variants
            .iter()
            .map(|variant| RustEnumVariant {
                name: variant.name.clone(),
                payload: variant.payload.as_ref().map(type_from_payload),
            })
            .collect(),
    }
}

fn type_from_payload(payload: &PayloadType) -> RustFieldType {
    match payload {
        PayloadType::Named(name) => RustFieldType::Named(name.clone()),
        PayloadType::Bytes => RustFieldType::Bytes,
        PayloadType::JsonValue => RustFieldType::JsonValue,
        PayloadType::StringScalar => RustFieldType::String,
    }
}

fn struct_from_payload(
    name: String,
    payload: &Payload,
    iap2_csm: Option<&'static str>,
) -> RustStruct {
    RustStruct {
        name,
        iap2_csm: iap2_csm.map(ToOwned::to_owned),
        fields: payload
            .fields
            .iter()
            .map(|field| RustField {
                name: field.name.to_string(),
                ty: type_from_field(field),
            })
            .collect(),
    }
}

fn struct_from_csm(csm: &Csm) -> RustStruct {
    RustStruct {
        name: csm.name.to_string(),
        iap2_csm: Some(csm.name.to_string()),
        fields: csm
            .params
            .iter()
            .map(|field| RustField {
                name: field.name.to_string(),
                ty: type_from_csm_field(field),
            })
            .collect(),
    }
}

fn type_from_csm_field(field: &CsmField) -> RustFieldType {
    let ty = match field.kind {
        CsmFieldKind::Bool => RustFieldType::Bool,
        CsmFieldKind::U8 => RustFieldType::U8,
        CsmFieldKind::I8 => RustFieldType::I8,
        CsmFieldKind::U16 => RustFieldType::U16,
        CsmFieldKind::I16 => RustFieldType::I16,
        CsmFieldKind::U32 => RustFieldType::U32,
        CsmFieldKind::I32 => RustFieldType::I32,
        CsmFieldKind::U64 => RustFieldType::U64,
        CsmFieldKind::I64 => RustFieldType::I64,
        CsmFieldKind::String => RustFieldType::String,
        CsmFieldKind::Bytes => RustFieldType::Named("Bytes".to_string()),
    };
    if field.required {
        ty
    } else {
        RustFieldType::Option(Box::new(ty))
    }
}

fn type_from_field(field: &Field) -> RustFieldType {
    let ty = match field.kind {
        FieldKind::Bool => RustFieldType::Bool,
        FieldKind::U8 => RustFieldType::U8,
        FieldKind::U16 => RustFieldType::U16,
        FieldKind::U32 => RustFieldType::U32,
        FieldKind::U64 => RustFieldType::U64,
        FieldKind::I64 => RustFieldType::I64,
        FieldKind::F64 => RustFieldType::F64,
        FieldKind::String => RustFieldType::String,
        FieldKind::StringArray => RustFieldType::Vec(Box::new(RustFieldType::String)),
        FieldKind::NumberArray => RustFieldType::Vec(Box::new(RustFieldType::F64)),
        FieldKind::Object | FieldKind::Json => RustFieldType::JsonValue,
        FieldKind::ObjectArray => RustFieldType::Vec(Box::new(RustFieldType::JsonValue)),
        FieldKind::BytesBase64 => RustFieldType::String,
    };

    if field.required {
        ty
    } else {
        RustFieldType::Option(Box::new(ty))
    }
}

fn empty_schema() -> RustSchema {
    RustSchema {
        modules: all_families()
            .into_iter()
            .map(|family| RustModule {
                family,
                items: Vec::new(),
            })
            .collect(),
    }
}

fn push_item(schema: &mut RustSchema, family: Family, item: RustItem) {
    let module = schema
        .modules
        .iter_mut()
        .find(|module| module.family == family)
        .expect("all families initialized");
    module.items.push(item);
}

fn sort_schema(schema: &mut RustSchema) {
    for module in &mut schema.modules {
        module.items.sort_by(|a, b| a.name().cmp(b.name()));
    }
}

fn empty_family_variants() -> Vec<(Family, Vec<RustEnumVariant>)> {
    all_families()
        .into_iter()
        .map(|family| (family, Vec::new()))
        .collect()
}

fn variants_for(
    variants: &mut [(Family, Vec<RustEnumVariant>)],
    family: Family,
) -> &mut Vec<RustEnumVariant> {
    &mut variants
        .iter_mut()
        .find(|(candidate, _)| *candidate == family)
        .expect("all families initialized")
        .1
}

fn complete_modules(schema: &RustSchema) -> Vec<RustModule> {
    all_families()
        .into_iter()
        .map(|family| {
            let mut module = schema
                .modules
                .iter()
                .find(|module| module.family == family)
                .cloned()
                .unwrap_or_else(|| RustModule {
                    family,
                    items: Vec::new(),
                });
            module.items.sort_by(|a, b| a.name().cmp(b.name()));
            module
        })
        .collect()
}

fn render_root_module(modules: &[RustModule]) -> String {
    let mut out = generated_header();
    for family in all_families() {
        out.push_str(&format!("pub mod {};\n", family_file_stem(family)));
    }
    out.push('\n');
    for module in modules.iter().filter(|module| !module.items.is_empty()) {
        let module = family_file_stem(module.family);
        out.push_str(&format!("pub use {module}::*;\n"));
    }
    out
}

fn render_family_module(module: &RustModule) -> String {
    let mut out = generated_header();
    if !module.items.is_empty() {
        out.push_str("use serde::{Deserialize, Serialize};\n\n");
        if module.uses_bytes_crate() {
            out.push_str("use bytes::Bytes;\n\n");
        }
    }

    for item in &module.items {
        match item {
            RustItem::Struct(item) => render_struct(&mut out, item),
            RustItem::Enum(item) => render_enum(&mut out, item),
        }
        out.push('\n');
    }

    out
}

fn render_struct(out: &mut String, item: &RustStruct) {
    out.push_str(&format!("#[derive({DERIVE_ATTR})]\n"));
    if item.fields.is_empty() {
        out.push_str(&format!("pub struct {};\n", item.name));
        render_iap2_csm_from_impl(out, item);
        return;
    }

    out.push_str(&format!("pub struct {} {{\n", item.name));
    for field in &item.fields {
        out.push_str(&format!(
            "  pub {}: {},\n",
            rust_field_ident(&field.name),
            field.ty.rust()
        ));
    }
    out.push_str("}\n");
    render_iap2_csm_from_impl(out, item);
}

fn render_iap2_csm_from_impl(out: &mut String, item: &RustStruct) {
    let Some(csm) = &item.iap2_csm else {
        return;
    };

    for source_path in iap2_csm_source_paths(csm) {
        render_iap2_csm_from_impl_for(out, item, &source_path);
    }
}

fn render_iap2_csm_from_impl_for(out: &mut String, item: &RustStruct, source_path: &str) {
    out.push_str("#[cfg(feature = \"iap2\")]\n");
    out.push_str(&format!("impl From<{source_path}> for {} {{\n", item.name));
    if item.fields.is_empty() {
        out.push_str(&format!("    fn from(_value: {source_path}) -> Self {{\n"));
        out.push_str("        Self\n");
    } else {
        out.push_str(&format!("    fn from(value: {source_path}) -> Self {{\n"));
        out.push_str("        Self {\n");
        for field in &item.fields {
            let field_name = rust_field_ident(&field.name);
            out.push_str(&format!("            {field_name}: value.{field_name},\n"));
        }
        out.push_str("        }\n");
    }
    out.push_str("    }\n");
    out.push_str("}\n");
}

fn iap2_csm_source_paths(csm: &str) -> Vec<String> {
    let mut paths = vec![format!("iap2_rs::csm::generated::{csm}")];
    let module = match csm {
        "RequestAuthenticationCertificate"
        | "AuthenticationCertificate"
        | "RequestAuthenticationChallengeResponse"
        | "AuthenticationResponse"
        | "AuthenticationFailed"
        | "AuthenticationSucceeded" => Some("auth"),
        "StartIdentification" | "IdentificationAccepted" => Some("identification"),
        "DeviceInformationUpdate"
        | "DeviceLanguageUpdate"
        | "DeviceTimeUpdate"
        | "DeviceUUIDUpdate" => Some("device"),
        _ => None,
    };
    if let Some(module) = module {
        paths.push(format!("iap2_rs::csm::{module}::{csm}"));
    }
    paths
}

fn rust_field_ident(name: &str) -> String {
    match name {
        "as" | "async" | "await" | "break" | "const" | "continue" | "crate" | "dyn" | "else"
        | "enum" | "extern" | "false" | "fn" | "for" | "if" | "impl" | "in" | "let" | "loop"
        | "match" | "mod" | "move" | "mut" | "pub" | "ref" | "return" | "self" | "Self"
        | "static" | "struct" | "super" | "trait" | "true" | "type" | "unsafe" | "use"
        | "where" | "while" => format!("r#{name}"),
        _ => name.to_string(),
    }
}

fn render_enum(out: &mut String, item: &RustEnum) {
    out.push_str(&format!("#[derive({DERIVE_ATTR})]\n"));
    if let Some(tag_field) = &item.tag_field {
        out.push_str(&format!(
            "#[serde(tag = {tag_field:?}, content = \"data\")]\n"
        ));
    }
    out.push_str(&format!("pub enum {} {{\n", item.name));
    for variant in &item.variants {
        match &variant.payload {
            Some(payload) => out.push_str(&format!("  {}({}),\n", variant.name, payload.rust())),
            None => out.push_str(&format!("  {},\n", variant.name)),
        }
    }
    out.push_str("}\n");
}

fn render_iap2_csm_module(csms: &[Csm]) -> String {
    let mut out = generated_header();
    out.push_str("// Hand-written csm::* modules remain authoritative. Import this module explicitly while migrating CSMs from inventory entries.\n\n");

    out.push_str("use serde::{Deserialize, Serialize};\n");
    if csms.iter().any(csm_uses_bytes) {
        out.push_str("use bytes::Bytes;\n\n");
    } else {
        out.push('\n');
    }

    render_csm_direction_list(&mut out, "SENT_BY_ACCESSORY", csms, |direction| {
        matches!(
            direction,
            CsmDirection::SentByAccessory | CsmDirection::Bidirectional
        )
    });
    render_csm_direction_list(&mut out, "RECEIVED_BY_ACCESSORY", csms, |direction| {
        matches!(
            direction,
            CsmDirection::ReceivedByAccessory | CsmDirection::Bidirectional
        )
    });
    out.push('\n');

    for csm in csms {
        render_csm_struct(&mut out, csm);
        out.push('\n');
    }

    out
}

fn csm_uses_bytes(csm: &Csm) -> bool {
    csm.params
        .iter()
        .any(|field| matches!(field.kind, CsmFieldKind::Bytes))
}

fn render_csm_direction_list(
    out: &mut String,
    name: &str,
    csms: &[Csm],
    include: impl Fn(CsmDirection) -> bool,
) {
    out.push_str(&format!("pub const {name}: &[u16] = &[\n"));
    for csm in csms.iter().filter(|csm| include(csm.direction)) {
        out.push_str(&format!("    {}::CSM_MSG_ID,\n", csm.name));
    }
    out.push_str("];\n");
}

fn render_csm_struct(out: &mut String, csm: &Csm) {
    push_rust_doc(out, csm.doc);
    out.push_str(
        "#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, iap2_macros::Csm)]\n",
    );
    out.push_str(&format!("#[csm(id = {})]\n", csm_msg_id(csm.msg_id)));
    if csm.params.is_empty() {
        out.push_str(&format!("pub struct {} {{}}\n", csm.name));
        return;
    }

    out.push_str(&format!("pub struct {} {{\n", csm.name));
    for field in csm.params {
        push_rust_doc(out, field.doc);
        out.push_str(&format!("    #[csm(param = {})]\n", field.param_id));
        out.push_str(&format!(
            "    pub {}: {},\n",
            rust_field_ident(field.name),
            csm_field_ty(field)
        ));
    }
    out.push_str("}\n");
}

fn csm_field_ty(field: &CsmField) -> String {
    let ty = match field.kind {
        CsmFieldKind::Bool => "bool",
        CsmFieldKind::U8 => "u8",
        CsmFieldKind::I8 => "i8",
        CsmFieldKind::U16 => "u16",
        CsmFieldKind::I16 => "i16",
        CsmFieldKind::U32 => "u32",
        CsmFieldKind::I32 => "i32",
        CsmFieldKind::U64 => "u64",
        CsmFieldKind::I64 => "i64",
        CsmFieldKind::String => "String",
        CsmFieldKind::Bytes => "Bytes",
    };
    if field.required {
        ty.to_string()
    } else {
        format!("Option<{ty}>")
    }
}

fn csm_msg_id(id: CsmMessageId) -> String {
    format!("0x{:04X}", id.0)
}

fn push_rust_doc(out: &mut String, doc: &str) {
    if doc.is_empty() {
        return;
    }
    for line in doc.lines() {
        out.push_str("/// ");
        out.push_str(line);
        out.push('\n');
    }
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
    const AUTH_CERT_PARAMS: &[CsmField] = &[CsmField {
        name: "cert",
        param_id: 0,
        kind: CsmFieldKind::Bytes,
        required: true,
        doc: "DER certificate bytes.",
    }];
    const AUTH_CERT_CSM: Csm = Csm {
        name: "AuthenticationCertificate",
        family: Family::Iap2,
        msg_id: CsmMessageId(0xAA01),
        direction: CsmDirection::SentByAccessory,
        params: AUTH_CERT_PARAMS,
        doc: "Accessory authentication certificate.",
    };

    #[test]
    fn emits_family_module_with_derive_and_snake_case_fields() {
        let method = Method {
            name: "set_volume",
            family: Family::Device,
            source: "setVolume",
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
            iap2_csm: Some("BatteryChangedCsm"),
            doc: "Battery state changed.",
        };
        let schema = schema_from_methods_events(&[method], &[event]);
        let module = schema
            .modules
            .iter()
            .find(|module| module.family == Family::Device)
            .expect("device module emitted");

        let out = render_family_module(module);

        assert!(out.contains("use serde::{Deserialize, Serialize};"));
        assert!(out.contains("#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]\npub struct SetVolumeRequest"));
        assert!(out.contains("pub volume_percent: u8,"));
        assert!(out.contains("pub is_charging: bool,"));
        assert!(out.contains("pub enum DeviceMethod"));
        assert!(out.contains("SetVolume(SetVolumeRequest),"));
        assert!(out.contains("#[serde(tag = \"event\", content = \"data\")]"));
        assert!(out.contains("BatteryChanged(BatteryChangedEvent),"));
        assert!(out.contains("#[cfg(feature = \"iap2\")]\nimpl From<iap2_rs::csm::generated::BatteryChangedCsm> for BatteryChangedEvent"));
        assert!(out.contains("is_charging: value.is_charging,"));
    }

    #[test]
    fn root_module_re_exports_each_family_module() {
        let schema = schema_from_methods_events(
            &[Method {
                name: "set_volume",
                family: Family::Device,
                source: "setVolume",
                aliases: &[],
                request: SET_VOLUME_REQUEST,
                response: SET_VOLUME_RESPONSE,
                doc: "Set playback volume.",
            }],
            &[],
        );
        let modules = complete_modules(&schema);
        let out = render_root_module(&modules);

        assert!(out.contains("pub mod device;"));
        assert!(out.contains("pub use device::*;"));
        assert!(out.contains("pub mod media_control;"));
        assert!(out.contains("pub mod bt_only;"));
        assert!(!out.contains("pub use bt_only::*;"));
    }

    #[test]
    fn emits_iap2_csm_module_with_csm_derive_and_param_attrs() {
        let out = render_iap2_csm_module(&[AUTH_CERT_CSM]);

        assert!(out.contains("use serde::{Deserialize, Serialize};"));
        assert!(out.contains("use bytes::Bytes;"));
        assert!(out.contains("pub const SENT_BY_ACCESSORY: &[u16] = &["));
        assert!(out.contains("AuthenticationCertificate::CSM_MSG_ID,"));
        assert!(out.contains(
            "#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, iap2_macros::Csm)]"
        ));
        assert!(out.contains("#[csm(id = 0xAA01)]"));
        assert!(out.contains("pub struct AuthenticationCertificate"));
        assert!(out.contains("#[csm(param = 0)]"));
        assert!(out.contains("pub cert: Bytes,"));
    }
}
