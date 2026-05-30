//! `#[derive(WireRequest)]` - emit a `WireRequest` impl for a request
//! payload type, plus the `From<Self> for <Outbound>` lift and a
//! cross-direction compile-time validation that the declared response
//! variant exists, is tagged `#[bridge_response]`, and matches the
//! declared payload type.
//!
//! Usage:
//!
//! ```ignore
//! #[derive(..., WireRequest)]
//! #[wire_request(
//!     direction = ClientToBridge,        // request goes webapp -> daemon
//!     surface = Asset,                   // outer wire variant on both directions
//!     request_variant = Get,
//!     response = AssetGot,
//!     response_variant = Got,
//!     // optional: domain error
//!     // error = AssetNotFound,
//!     // error_variant = NotFound,
//! )]
//! pub struct AssetGet { pub id: String }
//! ```
//!
//! `direction` is one of the four wire-direction prefixes recognized by
//! `BridgeEnum`. Outbound and inbound wire data types are derived from
//! the direction - request enters Outbound, response arrives on Inbound.
//! The Outbound inner enum is `<Direction><Surface>Msg`; the response /
//! error inner enum lives on the opposite-direction sibling
//! `<OppositeDirection><Surface>Msg`.

use proc_macro2::{Span, TokenStream as TokenStream2};
use proc_macro_crate::{crate_name, FoundCrate};
use quote::{format_ident, quote};
use syn::{spanned::Spanned, Attribute, Data, DeriveInput, Fields, Ident, Type};

#[derive(Copy, Clone, PartialEq, Eq)]
enum Direction {
    BridgeToGateway,
    GatewayToBridge,
    BridgeToClient,
    ClientToBridge,
}

impl Direction {
    fn from_ident(ident: &Ident) -> syn::Result<Self> {
        let s = ident.to_string();
        match s.as_str() {
            "BridgeToGateway" => Ok(Self::BridgeToGateway),
            "GatewayToBridge" => Ok(Self::GatewayToBridge),
            "BridgeToClient" => Ok(Self::BridgeToClient),
            "ClientToBridge" => Ok(Self::ClientToBridge),
            _ => Err(syn::Error::new(
                ident.span(),
                format!(
                    "unknown direction `{s}`; expected one of: \
           BridgeToGateway, GatewayToBridge, BridgeToClient, ClientToBridge"
                ),
            )),
        }
    }

    fn opposite(self) -> Self {
        match self {
            Self::BridgeToGateway => Self::GatewayToBridge,
            Self::GatewayToBridge => Self::BridgeToGateway,
            Self::BridgeToClient => Self::ClientToBridge,
            Self::ClientToBridge => Self::BridgeToClient,
        }
    }

    /// Outer wire data type the request lifts into / the response arrives on.
    fn outer_wire(self, lib: &TokenStream2) -> TokenStream2 {
        match self {
            Self::BridgeToGateway => quote!(#lib::gateway::BridgeToGatewayMsgData),
            Self::GatewayToBridge => quote!(#lib::gateway::GatewayToBridgeMsgData),
            Self::BridgeToClient => quote!(#lib::client::BridgeToClientMsgData),
            Self::ClientToBridge => quote!(#lib::client::ClientToBridgeMsgData),
        }
    }

    /// Inner enum for a given surface ident. `<Direction><Surface>Msg`.
    fn inner_for(self, lib: &TokenStream2, surface: &Ident) -> TokenStream2 {
        let prefix = match self {
            Self::BridgeToGateway => "BridgeToGateway",
            Self::GatewayToBridge => "GatewayToBridge",
            Self::BridgeToClient => "BridgeToClient",
            Self::ClientToBridge => "ClientToBridge",
        };
        let module = match self {
            Self::BridgeToGateway | Self::GatewayToBridge => quote!(gateway),
            Self::BridgeToClient | Self::ClientToBridge => quote!(client),
        };
        let inner = format_ident!("{}{}Msg", prefix, surface);
        quote!(#lib::#module::#inner)
    }
}

struct RequestAttr {
    direction: Direction,
    surface: Ident,
    request_variant: Ident,
    response: Type,
    response_variant: Ident,
    /// Wire variant is `Variant(Box<T>)` but `Self::Response = T`. `extract` auto-derefs,
    /// `encode_response` auto-boxes, and the cross-direction assertion checks `PhantomData<Box<T>>`.
    boxed_response: bool,
    error: Option<Type>,
    error_variant: Option<Ident>,
    /// Same as `boxed_response` for the domain-error variant.
    boxed_error: bool,
}

fn parse_attr(attrs: &[Attribute], parent_span: Span) -> syn::Result<RequestAttr> {
    for attr in attrs {
        if !attr.path().is_ident("wire_request") {
            continue;
        }
        let mut direction: Option<Direction> = None;
        let mut surface: Option<Ident> = None;
        let mut request_variant: Option<Ident> = None;
        let mut response: Option<Type> = None;
        let mut response_variant: Option<Ident> = None;
        let mut boxed_response = false;
        let mut error: Option<Type> = None;
        let mut error_variant: Option<Ident> = None;
        let mut boxed_error = false;

        attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("direction") {
                let id: Ident = meta.value()?.parse()?;
                direction = Some(Direction::from_ident(&id)?);
            } else if meta.path.is_ident("surface") {
                surface = Some(meta.value()?.parse()?);
            } else if meta.path.is_ident("request_variant") {
                request_variant = Some(meta.value()?.parse()?);
            } else if meta.path.is_ident("response") {
                response = Some(meta.value()?.parse()?);
            } else if meta.path.is_ident("response_variant") {
                response_variant = Some(meta.value()?.parse()?);
            } else if meta.path.is_ident("boxed_response") {
                boxed_response = true;
            } else if meta.path.is_ident("error") {
                error = Some(meta.value()?.parse()?);
            } else if meta.path.is_ident("error_variant") {
                error_variant = Some(meta.value()?.parse()?);
            } else if meta.path.is_ident("boxed_error") {
                boxed_error = true;
            } else {
                return Err(meta.error("unsupported wire_request key"));
            }
            Ok(())
        })?;

        let direction = direction
            .ok_or_else(|| syn::Error::new(attr.span(), "wire_request missing `direction = …`"))?;
        let surface = surface
            .ok_or_else(|| syn::Error::new(attr.span(), "wire_request missing `surface = …`"))?;
        let request_variant = request_variant.ok_or_else(|| {
            syn::Error::new(attr.span(), "wire_request missing `request_variant = …`")
        })?;
        let response = response
            .ok_or_else(|| syn::Error::new(attr.span(), "wire_request missing `response = …`"))?;
        let response_variant = response_variant.ok_or_else(|| {
            syn::Error::new(attr.span(), "wire_request missing `response_variant = …`")
        })?;

        if error.is_some() != error_variant.is_some() {
            return Err(syn::Error::new(
                attr.span(),
                "wire_request requires both or neither of `error` and `error_variant`",
            ));
        }
        if boxed_error && error.is_none() {
            return Err(syn::Error::new(
                attr.span(),
                "wire_request `boxed_error` requires `error` and `error_variant`",
            ));
        }

        return Ok(RequestAttr {
            direction,
            surface,
            request_variant,
            response,
            response_variant,
            boxed_response,
            error,
            error_variant,
            boxed_error,
        });
    }
    Err(syn::Error::new(
        parent_span,
        "missing #[wire_request(…)] attribute",
    ))
}

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

/// Returns true if the request payload is a unit struct (no fields).
fn is_unit_struct(ast: &DeriveInput) -> syn::Result<bool> {
    match &ast.data {
        Data::Struct(s) => match &s.fields {
            Fields::Unit => Ok(true),
            _ => Ok(false),
        },
        _ => Err(syn::Error::new(
            ast.span(),
            "WireRequest only supports structs (the request payload type)",
        )),
    }
}

pub(crate) fn expand(ast: &DeriveInput) -> syn::Result<TokenStream2> {
    let attr = parse_attr(&ast.attrs, ast.span())?;
    let unit_request = is_unit_struct(ast)?;

    let req_ty = &ast.ident;
    let lib = lib_crate_path();
    let outbound_wire = attr.direction.outer_wire(&lib);
    let outbound_inner = attr.direction.inner_for(&lib, &attr.surface);
    let response_dir = attr.direction.opposite();
    let response_wire = response_dir.outer_wire(&lib);
    let response_inner = response_dir.inner_for(&lib, &attr.surface);

    let response_inner_ident = match response_dir {
        Direction::BridgeToGateway => format_ident!("BridgeToGateway{}Msg", attr.surface),
        Direction::GatewayToBridge => format_ident!("GatewayToBridge{}Msg", attr.surface),
        Direction::BridgeToClient => format_ident!("BridgeToClient{}Msg", attr.surface),
        Direction::ClientToBridge => format_ident!("ClientToBridge{}Msg", attr.surface),
    };
    let response_marker_mod = format_ident!("__{}_responses", response_inner_ident);
    let response_marker_path = match response_dir {
        Direction::BridgeToGateway | Direction::GatewayToBridge => {
            quote!(#lib::gateway::#response_marker_mod)
        }
        Direction::BridgeToClient | Direction::ClientToBridge => {
            quote!(#lib::client::#response_marker_mod)
        }
    };

    let request_variant = &attr.request_variant;
    let response_ty = &attr.response;
    let response_variant = &attr.response_variant;

    let surface_variant = &attr.surface;

    let from_impl = if unit_request {
        quote! {
          impl ::core::convert::From<#req_ty> for #outbound_wire {
            fn from(_: #req_ty) -> Self {
              #outbound_wire::#surface_variant(
                #outbound_inner::#request_variant
              )
            }
          }
        }
    } else {
        quote! {
          impl ::core::convert::From<#req_ty> for #outbound_wire {
            fn from(payload: #req_ty) -> Self {
              #outbound_wire::#surface_variant(
                #outbound_inner::#request_variant(payload)
              )
            }
          }
        }
    };

    let (response_extract_value, response_encode_value, response_assertion_ty) =
        if attr.boxed_response {
            (
                quote! { *v },
                quote! { ::std::boxed::Box::new(v) },
                quote! { ::std::boxed::Box<<#req_ty as #lib::wire::WireRequest>::Response> },
            )
        } else {
            (
                quote! { v },
                quote! { v },
                quote! { <#req_ty as #lib::wire::WireRequest>::Response },
            )
        };

    let (domain_error_ty, extract_arms_error, encode_domain_error_body, error_assertion) =
        if let (Some(err_ty), Some(err_variant)) = (&attr.error, &attr.error_variant) {
            let (err_extract, err_encode, err_assertion_ty) = if attr.boxed_error {
                (
                    quote! { *e },
                    quote! { ::std::boxed::Box::new(err) },
                    quote! { ::std::boxed::Box<<#req_ty as #lib::wire::WireRequest>::DomainError> },
                )
            } else {
                (
                    quote! { e },
                    quote! { err },
                    quote! { <#req_ty as #lib::wire::WireRequest>::DomainError },
                )
            };
            let extract = quote! {
              #response_wire::#surface_variant(
                #response_inner::#err_variant(e),
              ) => ::core::result::Result::Err(#lib::wire::RequestError::Domain(#err_extract)),
            };
            let encode = quote! {
              #response_wire::#surface_variant(
                #response_inner::#err_variant(#err_encode),
              )
            };
            let assertion = quote! {
              let _ = #response_marker_path::#err_variant(
                ::core::marker::PhantomData::<#err_assertion_ty>,
              );
            };
            (quote! { #err_ty }, extract, quote! { #encode }, assertion)
        } else {
            (
                quote! { ::core::convert::Infallible },
                quote! {},
                quote! { match err {} },
                quote! {},
            )
        };

    let response_assertion = quote! {
      let _ = #response_marker_path::#response_variant(
        ::core::marker::PhantomData::<#response_assertion_ty>,
      );
    };

    let trait_impl = quote! {
      impl #lib::wire::WireRequest for #req_ty {
        type Outbound = #outbound_wire;
        type Inbound = #response_wire;
        type Response = #response_ty;
        type DomainError = #domain_error_ty;

        fn extract(
          data: Self::Inbound,
        ) -> ::core::result::Result<Self::Response, #lib::wire::RequestError<Self::DomainError>> {
          match data {
            #response_wire::#surface_variant(
              #response_inner::#response_variant(v),
            ) => ::core::result::Result::Ok(#response_extract_value),
            #extract_arms_error
            #response_wire::Error(e) => {
              ::core::result::Result::Err(#lib::wire::RequestError::Protocol(e))
            }
            _ => ::core::result::Result::Err(#lib::wire::RequestError::ResponseMismatch),
          }
        }

        fn encode_response(v: Self::Response) -> Self::Inbound {
          #response_wire::#surface_variant(
            #response_inner::#response_variant(#response_encode_value),
          )
        }

        fn encode_domain_error(err: Self::DomainError) -> Self::Inbound {
          #encode_domain_error_body
        }
      }
    };

    let cross_assertion = quote! {
      const _: () = {
        #response_assertion
        #error_assertion
      };
    };

    Ok(quote! {
      #trait_impl
      #from_impl
      #cross_assertion
    })
}
