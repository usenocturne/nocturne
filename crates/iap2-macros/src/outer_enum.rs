//! `#[derive(BridgeOuterEnum)]` - auto-emit `From<T>` impls for the
//! four outer wire data enums (`BridgeToGatewayMsgData`,
//! `GatewayToBridgeMsgData`, `BridgeToClientMsgData`,
//! `ClientToBridgeMsgData`).
//!
//! Replaces `derive_more::From` so that boxed variants (`Variant(Box<T>)`)
//! get a `From<T> for Self` impl that auto-boxes - the unboxed and
//! boxed call sites are identical (`payload.into()` works either way).
//! Per-variant opt-in via `#[from]`, same as `derive_more::From`.

use proc_macro2::TokenStream as TokenStream2;
use quote::quote;
use syn::{spanned::Spanned, Data, DeriveInput, Fields};

use crate::bridge_enum::unwrap_box;

pub(crate) fn expand(ast: &DeriveInput) -> syn::Result<TokenStream2> {
    let Data::Enum(en) = &ast.data else {
        return Err(syn::Error::new(
            ast.span(),
            "BridgeOuterEnum only supports enums",
        ));
    };

    let name = &ast.ident;
    let mut out = TokenStream2::new();

    for v in &en.variants {
        let has_from = v.attrs.iter().any(|a| a.path().is_ident("from"));
        if !has_from {
            continue;
        }
        let Fields::Unnamed(u) = &v.fields else {
            return Err(syn::Error::new(
                v.span(),
                "BridgeOuterEnum #[from] requires a single-tuple variant",
            ));
        };
        if u.unnamed.len() != 1 {
            return Err(syn::Error::new(
                v.span(),
                "BridgeOuterEnum #[from] requires a single-tuple variant",
            ));
        }
        let v_ident = &v.ident;
        let ty = &u.unnamed[0].ty;
        if let Some(inner) = unwrap_box(ty) {
            out.extend(quote! {
              impl ::core::convert::From<#inner> for #name {
                fn from(value: #inner) -> Self {
                  Self::#v_ident(::std::boxed::Box::new(value))
                }
              }
            });
        } else {
            out.extend(quote! {
              impl ::core::convert::From<#ty> for #name {
                fn from(value: #ty) -> Self {
                  Self::#v_ident(value)
                }
              }
            });
        }
    }

    Ok(out)
}
