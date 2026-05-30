//! Placeholder root for the vendored libswupdate IPC client.
//!
//! The crate exists to compile and link the upstream `network_ipc.c`,
//! `network_ipc-if.c`, and `progress_ipc.c` sources (see `vendor/src/`) into a
//! static library named `swupdate_ipc_vendored`. Consumers reference this
//! crate so cargo emits the matching `cargo:rustc-link-lib=` directive; the
//! daemon declares its own `unsafe extern "C"` blocks against those symbols
//! in `nocturned::ota::swupdate::ffi`, so this crate intentionally exposes
//! no Rust API.

#![allow(non_upper_case_globals)]
#![allow(non_camel_case_types)]
#![allow(non_snake_case)]
