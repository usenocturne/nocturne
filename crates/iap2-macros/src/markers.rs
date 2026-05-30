//! Standalone marker derives for top-level outer-wire variant payload
//! types - types that appear directly as variants on a wire data enum
//! without an intermediate inner enum (e.g. `BridgeThingMeta`,
//! `GatewayMeta`, `ForwardMessage`, `NowPlayingUpdate`).
//!
//! Each derive emits one `impl WireEvent<W> for Self` /
//! `impl WireCommand<W> for Self` / `impl WireUnicast<W> for Self` per
//! wire-direction listed in the `#[wire(...)]` attribute. Recognized
//! direction tokens - exactly the four known by `BridgeEnum`:
//!
//! - `BridgeToGateway` -> `BridgeToGatewayMsgData`
//! - `GatewayToBridge` -> `GatewayToBridgeMsgData`
//! - `BridgeToClient`  -> `BridgeToClientMsgData`
//! - `ClientToBridge`  -> `ClientToBridgeMsgData`
//!
//! Usage:
//!
//! ```ignore
//! #[derive(WireEvent)]
//! #[wire(BridgeToGateway, BridgeToClient)]
//! pub struct ForwardMessage { ... }
//! ```
//!
//! For inner enums that already use `#[derive(BridgeEnum)]`, the marker
//! impls land on the per-bucket sibling enums via direction inference -
//! these standalone derives are only for the non-enum-wrapped case.

use proc_macro2::{Span, TokenStream as TokenStream2};
use proc_macro_crate::{crate_name, FoundCrate};
use quote::quote;
use syn::{spanned::Spanned, Attribute, DeriveInput, Ident};

fn lib_crate_path() -> TokenStream2 {
    match crate_name("libbridgething") {
        Ok(FoundCrate::Itself) => quote!(crate),
        Ok(FoundCrate::Name(name)) => {
            let ident = Ident::new(&name, Span::call_site());
            quote!(::#ident)
        }
        Err(_) => quote!(::libbridgething),
    }
}

fn wire_path_for(direction: &str, lib: &TokenStream2) -> Option<TokenStream2> {
    match direction {
        "BridgeToGateway" => Some(quote!(#lib::gateway::BridgeToGatewayMsgData)),
        "GatewayToBridge" => Some(quote!(#lib::gateway::GatewayToBridgeMsgData)),
        "BridgeToClient" => Some(quote!(#lib::client::BridgeToClientMsgData)),
        "ClientToBridge" => Some(quote!(#lib::client::ClientToBridgeMsgData)),
        _ => None,
    }
}

fn parse_wire_directions(attrs: &[Attribute]) -> syn::Result<Vec<String>> {
    let mut directions = Vec::new();
    for attr in attrs {
        if !attr.path().is_ident("wire") {
            continue;
        }
        attr.parse_nested_meta(|meta| {
            let last = meta
                .path
                .segments
                .last()
                .ok_or_else(|| meta.error("expected a direction ident"))?;
            let name = last.ident.to_string();
            if wire_path_for(&name, &quote!(_)).is_none() {
                return Err(meta.error(format!(
                    "unknown wire direction `{name}`; expected one of: \
           BridgeToGateway, GatewayToBridge, BridgeToClient, ClientToBridge"
                )));
            }
            directions.push(name);
            Ok(())
        })?;
    }
    Ok(directions)
}

pub(crate) fn expand(ast: &DeriveInput, marker: &str) -> syn::Result<TokenStream2> {
    let directions = parse_wire_directions(&ast.attrs)?;
    if directions.is_empty() {
        return Err(syn::Error::new(
            ast.span(),
            format!(
                "#[derive({marker})] requires a #[wire(<Direction>, ...)] attribute \
         listing one or more wire directions: BridgeToGateway, \
         GatewayToBridge, BridgeToClient, ClientToBridge"
            ),
        ));
    }
    let name = &ast.ident;
    let (impl_generics, ty_generics, where_clause) = ast.generics.split_for_impl();
    let lib = lib_crate_path();
    let marker_ident = Ident::new(marker, Span::call_site());

    let impls = directions.iter().map(|dir| {
    let wire = wire_path_for(dir, &lib).expect("validated above");
    quote! {
      impl #impl_generics #lib::wire::#marker_ident<#wire> for #name #ty_generics #where_clause {}
    }
  });

    Ok(quote! {
      #(#impls)*
    })
}
