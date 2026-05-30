//! `#[derive(Csm)]` - generates `From<X> for CsmFrame` and
//! `TryFrom<CsmFrame> for X` for iAP2 control-session messages.
//! Annotate a struct with `#[csm(id = 0x____)]`. Each field gets
//! `#[csm(param = N)]` to fix its parameter id; without an override,
//! ids are assigned in declaration order starting at 0.
//!
//! Field encoding is type-driven via the `CsmParamFieldEncode` /
//! `CsmParamFieldDecode` traits in `iap2_rs::csm`. Add a new
//! field type by impl'ing those traits; no macro changes required.

use proc_macro2::{Span, TokenStream as TokenStream2};
use proc_macro_crate::{crate_name, FoundCrate};
use quote::quote;
use syn::{spanned::Spanned, Attribute, Data, DeriveInput, Expr, ExprLit, Fields, Ident, Lit};

fn iap2_crate_path() -> TokenStream2 {
    match crate_name("iap2-rs") {
        Ok(FoundCrate::Itself) => quote!(crate),
        Ok(FoundCrate::Name(name)) => {
            let ident = Ident::new(&name, Span::call_site());
            quote!(::#ident)
        }
        Err(_) => quote!(::iap2_rs),
    }
}

pub(crate) fn expand(ast: &DeriveInput) -> syn::Result<TokenStream2> {
    let name = &ast.ident;
    let msg_id = parse_msg_id(&ast.attrs, ast.span())?;
    let iap2 = iap2_crate_path();

    let fields = match &ast.data {
        Data::Struct(s) => &s.fields,
        Data::Enum(_) | Data::Union(_) => {
            return Err(syn::Error::new(ast.span(), "Csm only supports structs"));
        }
    };

    let (encode_body, decode_body, ctor) = match fields {
        Fields::Unit => {
            let encode = quote! { let params: ::std::vec::Vec<#iap2::csm::CsmParam> = ::std::vec::Vec::new(); };
            let decode = quote! {};
            let ctor = quote! { Self };
            (encode, decode, ctor)
        }
        Fields::Named(named) => {
            let mut next_auto_id: u16 = 0;
            let mut encode_pieces = Vec::with_capacity(named.named.len());
            let mut decode_pieces = Vec::with_capacity(named.named.len());
            let mut ctor_idents = Vec::with_capacity(named.named.len());
            for field in &named.named {
                let ident = field.ident.as_ref().expect("named field");
                let ty = &field.ty;
                let param_id = match parse_param_id(&field.attrs)? {
                    Some(id) => id,
                    None => next_auto_id,
                };
                next_auto_id = param_id.saturating_add(1);

                encode_pieces.push(quote! {
          <#ty as #iap2::csm::CsmParamFieldEncode>::encode_field(value.#ident, #param_id, &mut params);
        });
                decode_pieces.push(quote! {
          let #ident = <#ty as #iap2::csm::CsmParamFieldDecode>::decode_field(#param_id, &mut params)?;
        });
                ctor_idents.push(ident.clone());
            }
            let encode = quote! {
              let mut params: ::std::vec::Vec<#iap2::csm::CsmParam> =
                ::std::vec::Vec::with_capacity(#next_auto_id as usize);
              #(#encode_pieces)*
            };
            let decode = quote! { #(#decode_pieces)* };
            let ctor = quote! { Self { #(#ctor_idents),* } };
            (encode, decode, ctor)
        }
        Fields::Unnamed(_) => {
            return Err(syn::Error::new(
                fields.span(),
                "Csm requires a unit struct or named fields; tuple structs are not supported",
            ));
        }
    };

    Ok(quote! {
      impl ::core::convert::From<#name> for #iap2::csm::CsmFrame {
        #[allow(unused_variables, unused_mut)]
        fn from(value: #name) -> Self {
          #encode_body
          #iap2::csm::CsmFrame { msg_id: #msg_id, params }
        }
      }

      impl ::core::convert::TryFrom<#iap2::csm::CsmFrame> for #name {
        type Error = #iap2::csm::CsmDecodeError;
        #[allow(unused_mut)]
        fn try_from(frame: #iap2::csm::CsmFrame) -> ::core::result::Result<Self, Self::Error> {
          if frame.msg_id != #msg_id {
            return ::core::result::Result::Err(#iap2::csm::CsmDecodeError::WrongMsgId {
              got: frame.msg_id,
              expected: #msg_id,
            });
          }
          let mut params = frame.params;
          #decode_body
          ::core::result::Result::Ok(#ctor)
        }
      }

      impl #name {
        pub const CSM_MSG_ID: u16 = #msg_id;
      }
    })
}

fn parse_msg_id(attrs: &[Attribute], parent_span: Span) -> syn::Result<u16> {
    for attr in attrs {
        if !attr.path().is_ident("csm") {
            continue;
        }
        let mut id: Option<u16> = None;
        attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("id") {
                let value = meta.value()?;
                let expr: Expr = value.parse()?;
                id = Some(expr_to_u16(&expr)?);
                Ok(())
            } else {
                Err(meta.error("unsupported csm container attribute"))
            }
        })?;
        if let Some(id) = id {
            return Ok(id);
        }
    }
    Err(syn::Error::new(
        parent_span,
        "missing #[csm(id = 0x____)] attribute",
    ))
}

fn parse_param_id(attrs: &[Attribute]) -> syn::Result<Option<u16>> {
    for attr in attrs {
        if !attr.path().is_ident("csm") {
            continue;
        }
        let mut id: Option<u16> = None;
        attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("param") {
                let value = meta.value()?;
                let expr: Expr = value.parse()?;
                id = Some(expr_to_u16(&expr)?);
                Ok(())
            } else {
                Err(meta.error("unsupported csm field attribute"))
            }
        })?;
        if id.is_some() {
            return Ok(id);
        }
    }
    Ok(None)
}

fn expr_to_u16(expr: &Expr) -> syn::Result<u16> {
    if let Expr::Lit(ExprLit {
        lit: Lit::Int(int), ..
    }) = expr
    {
        int.base10_parse::<u16>()
    } else {
        Err(syn::Error::new(expr.span(), "expected an integer literal"))
    }
}
