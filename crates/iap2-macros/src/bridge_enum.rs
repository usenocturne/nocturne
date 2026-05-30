//! `#[derive(BridgeEnum)]` - split a wire enum into per-category sibling
//! enums and emit the supporting trait infrastructure.
//!
//! Each variant is tagged with exactly one of `#[bridge_event]`,
//! `#[bridge_command]`, `#[bridge_request]`, `#[bridge_response]`. The
//! macro emits, per non-empty bucket:
//!
//! - `<Parent><Bucket>` enum with just that bucket's variants;
//! - `From<<Parent><Bucket>> for <Parent>` (sibling lifts to parent);
//! - `<Parent>::into_<bucket>(self) -> Option<<Parent><Bucket>>` and
//!   `<Parent>::is_<bucket>_variant(&self) -> bool`;
//! - For Event/Command: marker trait impl on the sibling
//!   (`impl WireEvent<<wire>> for <Sibling>` /
//!   `impl WireCommand<<wire>> for <Sibling>`), where `<wire>` is inferred
//!   from the parent ident's prefix. Plus `From<Sibling> for <OuterMsgData>`
//!   when the parent declares `#[bridge_enum(into = OuterPath)]`.
//! - For Response: a hidden `__<Parent>_responses` marker module,
//!   carrying one phantom-typed struct per response variant. The
//!   `#[derive(WireRequest)]` derive references these to compile-time-
//!   validate that a declared response variant exists, is tagged
//!   `#[bridge_response]`, and matches the declared payload type.
//!
//! Direction is inferred from the parent ident - one of the four
//! recognized prefixes:
//!
//! - `BridgeToGateway*` - daemon -> companion (Bluetooth gateway protocol)
//! - `GatewayToBridge*` - companion -> daemon (Bluetooth gateway protocol)
//! - `BridgeToClient*`  - daemon -> webapp (local WebSocket protocol)
//! - `ClientToBridge*`  - webapp -> daemon (local WebSocket protocol)

use std::collections::BTreeMap;

use proc_macro2::{Span, TokenStream as TokenStream2};
use proc_macro_crate::{crate_name, FoundCrate};
use quote::{format_ident, quote};
use syn::{
    spanned::Spanned, Attribute, Data, DeriveInput, Fields, Ident, Path, Type, Variant, Visibility,
};

/// Returns the inner `T` if `ty` is `Box<T>` (or `::std::boxed::Box<T>`).
pub(crate) fn unwrap_box(ty: &Type) -> Option<&Type> {
    use syn::{GenericArgument, PathArguments};
    let Type::Path(tp) = ty else { return None };
    let last = tp.path.segments.last()?;
    if last.ident != "Box" {
        return None;
    }
    let PathArguments::AngleBracketed(ab) = &last.arguments else {
        return None;
    };
    if ab.args.len() != 1 {
        return None;
    }
    match ab.args.first()? {
        GenericArgument::Type(inner) => Some(inner),
        _ => None,
    }
}

/// Qualify `ty` for use inside a `mod __X_responses { ... }` scope.
/// Bare idents get `super::`, `Box<T>` becomes `::std::boxed::Box<super::T>`,
/// already-rooted paths pass through unchanged.
fn qualify_payload_type(ty: &Type) -> TokenStream2 {
    use syn::{GenericArgument, PathArguments};

    let Type::Path(tp) = ty else {
        return quote!(super::#ty);
    };
    let path = &tp.path;
    let leading = path.leading_colon;
    let absolute = leading.is_some()
        || path
            .segments
            .first()
            .map(|s| s.ident == "crate" || s.ident == "self" || s.ident == "super")
            .unwrap_or(false);

    // single-segment: super-qualify user types, std-qualify Box (prelude; `super::Box` breaks).
    if !absolute && path.segments.len() == 1 {
        let seg = path.segments.first().expect("len 1 verified");
        let ident = &seg.ident;

        // Recurse into generic args so `Box<Foo>` qualifies the inner Foo.
        let qualified_args = match &seg.arguments {
            PathArguments::None => quote!(),
            PathArguments::AngleBracketed(ab) => {
                let inner: Vec<TokenStream2> = ab
                    .args
                    .iter()
                    .map(|arg| match arg {
                        GenericArgument::Type(t) => qualify_payload_type(t),
                        other => quote!(#other),
                    })
                    .collect();
                quote!(<#(#inner),*>)
            }
            PathArguments::Parenthesized(p) => quote!(#p),
        };

        return if ident == "Box" {
            quote!(::std::boxed::Box #qualified_args)
        } else {
            quote!(super::#ident #qualified_args)
        };
    }

    if absolute {
        quote!(#ty)
    } else {
        quote!(super::#ty)
    }
}

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
        if s.starts_with("BridgeToGateway") {
            Ok(Self::BridgeToGateway)
        } else if s.starts_with("GatewayToBridge") {
            Ok(Self::GatewayToBridge)
        } else if s.starts_with("BridgeToClient") {
            Ok(Self::BridgeToClient)
        } else if s.starts_with("ClientToBridge") {
            Ok(Self::ClientToBridge)
        } else {
            Err(syn::Error::new(
                ident.span(),
                "BridgeEnum requires the enum name to start with one of the four wire \
         direction prefixes: `BridgeToGateway`, `GatewayToBridge`, \
         `BridgeToClient`, or `ClientToBridge`",
            ))
        }
    }

    /// Path to the matching outer wire data enum. Lives in `lib::gateway`
    /// for the Bluetooth pair, `lib::client` for the WebSocket pair.
    fn wire_data_path(self, lib: &TokenStream2) -> TokenStream2 {
        match self {
            Self::BridgeToGateway => quote!(#lib::gateway::BridgeToGatewayMsgData),
            Self::GatewayToBridge => quote!(#lib::gateway::GatewayToBridgeMsgData),
            Self::BridgeToClient => quote!(#lib::client::BridgeToClientMsgData),
            Self::ClientToBridge => quote!(#lib::client::ClientToBridgeMsgData),
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
enum Bucket {
    Event,
    Command,
    Request,
    Response,
}

impl Bucket {
    fn suffix(self) -> &'static str {
        match self {
            Self::Event => "Event",
            Self::Command => "Command",
            Self::Request => "Request",
            Self::Response => "Response",
        }
    }

    fn snake(self) -> &'static str {
        match self {
            Self::Event => "event",
            Self::Command => "command",
            Self::Request => "request",
            Self::Response => "response",
        }
    }
}

fn variant_bucket(v: &Variant) -> syn::Result<Bucket> {
    let mut found: Option<(Bucket, Span)> = None;
    for attr in &v.attrs {
        let bucket = if attr.path().is_ident("bridge_event") {
            Some(Bucket::Event)
        } else if attr.path().is_ident("bridge_command") {
            Some(Bucket::Command)
        } else if attr.path().is_ident("bridge_request") {
            Some(Bucket::Request)
        } else if attr.path().is_ident("bridge_response") {
            Some(Bucket::Response)
        } else {
            None
        };
        if let Some(b) = bucket {
            if found.is_some() {
                return Err(syn::Error::new(
          attr.span(),
          "variant must have exactly one of #[bridge_event], #[bridge_command], #[bridge_request], #[bridge_response]",
        ));
            }
            found = Some((b, attr.span()));
        }
    }
    found.map(|(b, _)| b).ok_or_else(|| {
    syn::Error::new(
      v.span(),
      "variant must be tagged with one of #[bridge_event], #[bridge_command], #[bridge_request], #[bridge_response]",
    )
  })
}

fn parse_into_attr(attrs: &[Attribute]) -> syn::Result<Option<Path>> {
    for attr in attrs {
        if !attr.path().is_ident("bridge_enum") {
            continue;
        }
        let mut into: Option<Path> = None;
        attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("into") {
                let value = meta.value()?;
                let path: Path = value.parse()?;
                into = Some(path);
                Ok(())
            } else {
                Err(meta.error("unsupported bridge_enum container attribute"))
            }
        })?;
        if into.is_some() {
            return Ok(into);
        }
    }
    Ok(None)
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

fn validate_variant_fields(v: &Variant) -> syn::Result<()> {
    match &v.fields {
        Fields::Unit => Ok(()),
        Fields::Unnamed(u) if u.unnamed.len() == 1 => Ok(()),
        _ => Err(syn::Error::new(
            v.span(),
            "BridgeEnum supports only unit and single-tuple variants",
        )),
    }
}

pub(crate) fn expand(ast: &DeriveInput) -> syn::Result<TokenStream2> {
    let Data::Enum(en) = &ast.data else {
        return Err(syn::Error::new(
            ast.span(),
            "BridgeEnum only supports enums",
        ));
    };

    let parent = &ast.ident;
    let vis = &ast.vis;
    let direction = Direction::from_ident(parent)?;
    let into_outer = parse_into_attr(&ast.attrs)?;

    let mut grouped: BTreeMap<Bucket, Vec<&Variant>> = BTreeMap::new();
    for v in &en.variants {
        validate_variant_fields(v)?;
        let b = variant_bucket(v)?;
        grouped.entry(b).or_default().push(v);
    }

    let total: usize = grouped.values().map(|v| v.len()).sum();
    let lib_path = lib_crate_path();
    let wire_path = direction.wire_data_path(&lib_path);

    let mut out = TokenStream2::new();
    let mut method_pieces: Vec<TokenStream2> = Vec::new();

    for (&bucket, variants) in &grouped {
        out.extend(emit_sibling_enum(parent, vis, bucket, variants));
        out.extend(emit_from_sibling_for_parent(parent, bucket, variants));
        out.extend(emit_unbox_from_impls(
            parent,
            bucket,
            variants,
            into_outer.as_ref(),
        ));

        if bucket == Bucket::Event || bucket == Bucket::Command {
            let marker_name = match bucket {
                Bucket::Event => format_ident!("WireEvent"),
                Bucket::Command => format_ident!("WireCommand"),
                _ => unreachable!(),
            };
            out.extend(emit_marker_impl(
                &lib_path,
                &marker_name,
                &wire_path,
                parent,
                bucket,
            ));
            if let Some(outer) = &into_outer {
                out.extend(emit_from_sibling_for_outer(parent, bucket, outer));
            }
        }

        let needs_catchall = variants.len() < total;
        method_pieces.push(emit_into_method(parent, bucket, variants, needs_catchall));
        method_pieces.push(emit_is_variant_method(bucket, variants));
    }

    if !method_pieces.is_empty() {
        out.extend(quote! {
          impl #parent {
            #(#method_pieces)*
          }
        });
    }

    if let Some(response_vars) = grouped.get(&Bucket::Response) {
        out.extend(emit_response_marker_module(parent, vis, response_vars));
    }

    Ok(out)
}

fn emit_sibling_enum(
    parent: &Ident,
    vis: &Visibility,
    bucket: Bucket,
    variants: &[&Variant],
) -> TokenStream2 {
    let sibling = format_ident!("{}{}", parent, bucket.suffix());
    let decls = variants.iter().map(|v| {
        let v_ident = &v.ident;
        match &v.fields {
            Fields::Unit => quote! { #v_ident },
            Fields::Unnamed(u) => {
                let ty = &u.unnamed[0].ty;
                quote! { #v_ident(#ty) }
            }
            _ => unreachable!(),
        }
    });
    let doc = format!(
        "{}-tagged subset of [`{}`]. Construct via `<Parent>::into_{}` or directly.",
        bucket.suffix(),
        parent,
        bucket.snake(),
    );
    let macros_crate = macros_crate_path();
    quote! {
      #[doc = #doc]
      #[derive(::core::fmt::Debug, ::core::clone::Clone, #macros_crate::BridgeDispatch)]
      #vis enum #sibling {
        #(#decls),*
      }
    }
}

fn macros_crate_path() -> TokenStream2 {
    match proc_macro_crate::crate_name("iap2-macros") {
        Ok(proc_macro_crate::FoundCrate::Itself) => quote!(crate),
        Ok(proc_macro_crate::FoundCrate::Name(name)) => {
            let ident = Ident::new(&name, Span::call_site());
            quote!(::#ident)
        }
        Err(_) => quote!(::iap2_macros),
    }
}

fn emit_from_sibling_for_parent(
    parent: &Ident,
    bucket: Bucket,
    variants: &[&Variant],
) -> TokenStream2 {
    let sibling = format_ident!("{}{}", parent, bucket.suffix());
    let arms = variants.iter().map(|v| {
        let v_ident = &v.ident;
        match &v.fields {
            Fields::Unit => quote! { #sibling::#v_ident => #parent::#v_ident },
            Fields::Unnamed(_) => quote! { #sibling::#v_ident(p) => #parent::#v_ident(p) },
            _ => unreachable!(),
        }
    });
    quote! {
      impl ::core::convert::From<#sibling> for #parent {
        fn from(value: #sibling) -> Self {
          match value {
            #(#arms),*
          }
        }
      }
    }
}

fn emit_from_sibling_for_outer(parent: &Ident, bucket: Bucket, outer: &Path) -> TokenStream2 {
    let sibling = format_ident!("{}{}", parent, bucket.suffix());
    quote! {
      impl ::core::convert::From<#sibling> for #outer {
        fn from(value: #sibling) -> Self {
          let parent: #parent = ::core::convert::From::from(value);
          ::core::convert::From::from(parent)
        }
      }
    }
}

/// For each `Variant(Box<T>)` variant, emit unboxed `From<T>` impls so
/// callers can write `meta.into()` instead of `Box::new(meta).into()`.
/// The chain to the outer wire enum is also emitted when this enum has
/// `#[bridge_enum(into = ...)]`.
fn emit_unbox_from_impls(
    parent: &Ident,
    bucket: Bucket,
    variants: &[&Variant],
    outer: Option<&Path>,
) -> TokenStream2 {
    let sibling = format_ident!("{}{}", parent, bucket.suffix());
    let mut out = TokenStream2::new();
    for v in variants {
        let Fields::Unnamed(u) = &v.fields else {
            continue;
        };
        let Some(inner) = unwrap_box(&u.unnamed[0].ty) else {
            continue;
        };
        let v_ident = &v.ident;
        out.extend(quote! {
          impl ::core::convert::From<#inner> for #sibling {
            fn from(value: #inner) -> Self {
              #sibling::#v_ident(::std::boxed::Box::new(value))
            }
          }

          impl ::core::convert::From<#inner> for #parent {
            fn from(value: #inner) -> Self {
              #parent::#v_ident(::std::boxed::Box::new(value))
            }
          }
        });
        if let Some(outer) = outer {
            out.extend(quote! {
              impl ::core::convert::From<#inner> for #outer {
                fn from(value: #inner) -> Self {
                  let parent: #parent = ::core::convert::From::from(value);
                  ::core::convert::From::from(parent)
                }
              }
            });
        }
    }
    out
}

fn emit_marker_impl(
    lib_path: &TokenStream2,
    marker: &Ident,
    wire: &TokenStream2,
    parent: &Ident,
    bucket: Bucket,
) -> TokenStream2 {
    let sibling = format_ident!("{}{}", parent, bucket.suffix());
    quote! {
      impl #lib_path::wire::#marker<#wire> for #sibling {}
    }
}

fn emit_into_method(
    parent: &Ident,
    bucket: Bucket,
    variants: &[&Variant],
    needs_catchall: bool,
) -> TokenStream2 {
    let sibling = format_ident!("{}{}", parent, bucket.suffix());
    let method = format_ident!("into_{}", bucket.snake());
    let mut arms: Vec<TokenStream2> = variants
    .iter()
    .map(|v| {
      let v_ident = &v.ident;
      match &v.fields {
        Fields::Unit => quote! {
          Self::#v_ident => ::core::option::Option::Some(#sibling::#v_ident)
        },
        Fields::Unnamed(_) => quote! {
          Self::#v_ident(payload) => ::core::option::Option::Some(#sibling::#v_ident(payload))
        },
        _ => unreachable!(),
      }
    })
    .collect();
    if needs_catchall {
        arms.push(quote! { _ => ::core::option::Option::None });
    }
    let doc = format!(
        "Narrow to the {bucket}-typed sibling. Returns `None` for variants in other buckets.",
        bucket = bucket.snake(),
    );
    quote! {
      #[doc = #doc]
      pub fn #method(self) -> ::core::option::Option<#sibling> {
        match self {
          #(#arms),*
        }
      }
    }
}

fn emit_is_variant_method(bucket: Bucket, variants: &[&Variant]) -> TokenStream2 {
    let method = format_ident!("is_{}_variant", bucket.snake());
    let patterns = variants.iter().map(|v| {
        let v_ident = &v.ident;
        match &v.fields {
            Fields::Unit => quote! { Self::#v_ident },
            Fields::Unnamed(_) => quote! { Self::#v_ident(_) },
            _ => unreachable!(),
        }
    });
    let doc = format!(
        "Returns `true` for variants tagged `#[bridge_{}]`.",
        bucket.snake()
    );
    quote! {
      #[doc = #doc]
      pub fn #method(&self) -> bool {
        ::core::matches!(self, #(#patterns)|*)
      }
    }
}

fn emit_response_marker_module(
    parent: &Ident,
    vis: &Visibility,
    variants: &[&Variant],
) -> TokenStream2 {
    let mod_name = format_ident!("__{}_responses", parent);
    let entries = variants.iter().map(|v| {
        let v_ident = &v.ident;
        match &v.fields {
            Fields::Unit => quote! { pub struct #v_ident; },
            Fields::Unnamed(u) => {
                let ty = &u.unnamed[0].ty;
                let qualified = qualify_payload_type(ty);
                quote! { pub struct #v_ident(pub ::core::marker::PhantomData<#qualified>); }
            }
            _ => unreachable!(),
        }
    });
    let doc = format!(
        "Hidden marker module emitted by `BridgeEnum` for response variants of [`{}`]. \
     `#[derive(WireRequest)]` references these structs in a `const _: () = {{ \
     ... }}` block to compile-time-validate that the declared response variant exists, is tagged \
     `#[bridge_response]`, and matches the declared payload type.",
        parent
    );
    quote! {
      #[doc = #doc]
      #[doc(hidden)]
      #[allow(non_snake_case, non_camel_case_types, dead_code)]
      #vis mod #mod_name {
        #(#entries)*
      }
    }
}
