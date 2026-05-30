//! Builds the vendored libswupdate IPC client (`vendor/src/`) into a static
//! library and links it into consumers.
//!
//! Three upstream sources are compiled together:
//!
//!   * `network_ipc.c`     - sync control IPC (`ipc_inst_start_ext`, `ipc_send_data`, ...)
//!   * `network_ipc-if.c`  - `swupdate_prepare_req` and async install helpers
//!   * `progress_ipc.c`    - progress socket client
//!
//! Self-contained: no Yocto, no pkg-config, no libswupdate.so runtime
//! dependency. Headers under `vendor/include/` are LGPL-2.1-or-later from
//! sbabic/swupdate@2024.12 and stay in sync with the upstream IPC ABI.

use std::{env, path::PathBuf};

const VENDOR_SOURCES: &[&str] = &[
    "vendor/src/network_ipc.c",
    "vendor/src/network_ipc-if.c",
    "vendor/src/progress_ipc.c",
];

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let vendor_include = manifest_dir.join("vendor/include");

    println!("cargo:rerun-if-changed=vendor/include");
    println!("cargo:rerun-if-changed=vendor/src");
    println!("cargo:rustc-check-cfg=cfg(rust_analyzer)");

    let mut build = cc::Build::new();
    build
        .include(&vendor_include)
        .define("_GNU_SOURCE", None)
        .flag_if_supported("-Wno-pointer-sign")
        .flag_if_supported("-Wno-unused-parameter")
        .flag_if_supported("-Wno-unused-result")
        // network_ipc-if.c upstream forgets `#include <unistd.h>` for close().
        // We don't want to patch the vendor file, so allow implicit decls.
        .flag_if_supported("-Wno-error=implicit-function-declaration")
        .flag_if_supported("-Wno-implicit-function-declaration");
    for source in VENDOR_SOURCES {
        build.file(manifest_dir.join(source));
    }
    build.compile("swupdate_ipc_vendored");

    // network_ipc-if.c spawns an async install thread.
    println!("cargo:rustc-link-lib=pthread");
}
