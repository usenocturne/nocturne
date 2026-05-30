//! Proc-macro derives shared across the iap2-rs workspace.
//!
//! - `#[derive(Csm)]` - iAP2 control-session messages (see `csm.rs`).
//! - `#[derive(BridgeEnum)]` - wire enums; per-bucket sibling enums +
//!   marker impls + cross-enum response-validation modules. Direction
//!   inferred from one of four parent-ident prefixes: `BridgeToGateway`,
//!   `GatewayToBridge`, `BridgeToClient`, `ClientToBridge`. See
//!   `bridge_enum.rs`.
//! - `#[derive(BridgeOuterEnum)]` - outer wire data enums; per-variant
//!   `#[from]` opts in to a `From<T>` impl, with auto-boxing when the
//!   variant payload is `Box<T>`. Replaces `derive_more::From` for the
//!   four outer enums. See `outer_enum.rs`.
//! - `#[derive(WireRequest)]` keyed off `#[wire_request(...)]` -
//!   typed-request implementation + cross-enum compile-time validation.
//!   See `request.rs`.
//! - `#[derive(WireEvent)]` / `#[derive(WireCommand)]` /
//!   `#[derive(WireUnicast)]` keyed off `#[wire(<Direction>, ...)]` -
//!   marker derives for top-level outer-wire variant payload types
//!   (e.g. `BridgeThingMeta`, `GatewayMeta`, `ForwardMessage`,
//!   `NowPlayingUpdate`). See `markers.rs`.

use proc_macro::TokenStream;
use syn::{parse_macro_input, DeriveInput};

mod bridge_enum;
mod csm;
mod dispatch;
mod markers;
mod outer_enum;
mod request;

#[proc_macro_derive(Csm, attributes(csm))]
pub fn derive_csm(input: TokenStream) -> TokenStream {
    let ast = parse_macro_input!(input as DeriveInput);
    match csm::expand(&ast) {
        Ok(ts) => ts.into(),
        Err(err) => err.to_compile_error().into(),
    }
}

#[proc_macro_derive(
    BridgeEnum,
    attributes(
        bridge_enum,
        bridge_event,
        bridge_command,
        bridge_request,
        bridge_response
    )
)]
pub fn derive_bridge_enum(input: TokenStream) -> TokenStream {
    let ast = parse_macro_input!(input as DeriveInput);
    match bridge_enum::expand(&ast) {
        Ok(ts) => ts.into(),
        Err(err) => err.to_compile_error().into(),
    }
}

#[proc_macro_derive(WireRequest, attributes(wire_request))]
pub fn derive_wire_request(input: TokenStream) -> TokenStream {
    let ast = parse_macro_input!(input as DeriveInput);
    match request::expand(&ast) {
        Ok(ts) => ts.into(),
        Err(err) => err.to_compile_error().into(),
    }
}

#[proc_macro_derive(BridgeOuterEnum, attributes(from))]
pub fn derive_bridge_outer_enum(input: TokenStream) -> TokenStream {
    let ast = parse_macro_input!(input as DeriveInput);
    match outer_enum::expand(&ast) {
        Ok(ts) => ts.into(),
        Err(err) => err.to_compile_error().into(),
    }
}

#[proc_macro_derive(WireEvent, attributes(wire))]
pub fn derive_wire_event(input: TokenStream) -> TokenStream {
    let ast = parse_macro_input!(input as DeriveInput);
    match markers::expand(&ast, "WireEvent") {
        Ok(ts) => ts.into(),
        Err(err) => err.to_compile_error().into(),
    }
}

#[proc_macro_derive(WireCommand, attributes(wire))]
pub fn derive_wire_command(input: TokenStream) -> TokenStream {
    let ast = parse_macro_input!(input as DeriveInput);
    match markers::expand(&ast, "WireCommand") {
        Ok(ts) => ts.into(),
        Err(err) => err.to_compile_error().into(),
    }
}

#[proc_macro_derive(WireUnicast, attributes(wire))]
pub fn derive_wire_unicast(input: TokenStream) -> TokenStream {
    let ast = parse_macro_input!(input as DeriveInput);
    match markers::expand(&ast, "WireUnicast") {
        Ok(ts) => ts.into(),
        Err(err) => err.to_compile_error().into(),
    }
}

#[proc_macro_derive(BridgeDispatch)]
pub fn derive_bridge_dispatch(input: TokenStream) -> TokenStream {
    let ast = parse_macro_input!(input as DeriveInput);
    match dispatch::expand(&ast) {
        Ok(ts) => ts.into(),
        Err(err) => err.to_compile_error().into(),
    }
}
