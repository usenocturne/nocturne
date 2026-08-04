use std::{
    collections::{BTreeSet, HashMap},
    fs, io,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use nocturne_codegen::dispatch::{
    inventory::{EVENT_INVENTORY, Event, Family, Inventory, METHOD_INVENTORY, Method},
    kotlin::emit_kotlin_methods_events_to_dir,
    rust::emit_rust_methods_events_to_dir,
    swift::emit_swift_methods_events_to_dir,
    typescript::emit_typescript_methods_events_to_dir,
};

fn device_inventory() -> Inventory {
    let methods: Vec<Method> = METHOD_INVENTORY
        .iter()
        .copied()
        .filter(|method| method.family == Family::Device)
        .collect();
    let events: Vec<Event> = EVENT_INVENTORY
        .iter()
        .copied()
        .filter(|event| event.family == Family::Device)
        .collect();

    assert_eq!(methods.len(), 22, "device method fixture drifted");
    assert_eq!(events.len(), 6, "device event fixture drifted");

    Inventory {
        wire_enums: HashMap::new(),
        enums: HashMap::new(),
        markers: HashMap::new(),
        typed_requests: Vec::new(),
        methods: Box::leak(methods.into_boxed_slice()),
        events: Box::leak(events.into_boxed_slice()),
        csms: &[],
        uuid_field_names: BTreeSet::new(),
    }
}

fn snapshot_settings() -> insta::Settings {
    let mut settings = insta::Settings::clone_current();
    settings.set_snapshot_path("snapshots");
    settings
}

#[test]
fn rust_device_family_snapshot() {
    let output = render_device_file("rust", "device.rs", |inventory, out_dir| {
        emit_rust_methods_events_to_dir(inventory.methods, inventory.events, out_dir)
    });

    snapshot_settings().bind(|| insta::assert_snapshot!("rust_device", output));
}

#[test]
fn typescript_device_family_snapshot() {
    let output = render_device_file("typescript", "device.d.ts", |inventory, out_dir| {
        emit_typescript_methods_events_to_dir(inventory.methods, inventory.events, out_dir)
    });

    snapshot_settings().bind(|| insta::assert_snapshot!("typescript_device", output));
}

#[test]
fn swift_device_family_snapshot() {
    let output = render_device_file("swift", "device.swift", |inventory, out_dir| {
        emit_swift_methods_events_to_dir(inventory.methods, inventory.events, out_dir)
    });

    snapshot_settings().bind(|| insta::assert_snapshot!("swift_device", output));
}

#[test]
fn kotlin_device_family_snapshot() {
    let output = render_device_file("kotlin", "Device.kt", |inventory, out_dir| {
        emit_kotlin_methods_events_to_dir(inventory.methods, inventory.events, out_dir)
    });

    snapshot_settings().bind(|| insta::assert_snapshot!("kotlin_device", output));
}

fn render_device_file(
    language: &str,
    file_name: &str,
    emit: impl FnOnce(&Inventory, &Path) -> anyhow::Result<()>,
) -> String {
    let inventory = device_inventory();
    let out_dir = temp_output_dir(language);
    recreate_dir(&out_dir);

    emit(&inventory, &out_dir).expect("emit device family snapshot fixture");
    let output =
        fs::read_to_string(out_dir.join(file_name)).expect("read emitted device family file");
    fs::remove_dir_all(&out_dir).expect("remove snapshot temp output");

    output
}

fn temp_output_dir(language: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "nocturne-codegen-golden-{language}-{}-{nanos}",
        std::process::id()
    ))
}

fn recreate_dir(path: &Path) {
    match fs::remove_dir_all(path) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => panic!("remove {}: {error}", path.display()),
    }
    fs::create_dir_all(path).unwrap_or_else(|error| panic!("create {}: {error}", path.display()));
}
