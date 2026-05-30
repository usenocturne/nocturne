//! `#[derive(BridgeDispatch)]` - emit a dispatch trait + inherent
//! `dispatch` method on a wire-message inner enum.
//!
//! Given an enum like:
//!
//! ```ignore
//! #[derive(BridgeDispatch)]
//! pub enum ClientToBridgeFooMsg {
//!   Bar,
//!   Baz(BazPayload),
//! }
//! ```
//!
//! the macro emits:
//!
//! ```ignore
//! pub trait ClientToBridgeFooMsgDispatch {
//!   type Output;
//!   fn bar(&self) -> impl std::future::Future<Output = Self::Output> + Send;
//!   fn baz(&self, params: BazPayload) -> impl std::future::Future<Output = Self::Output> + Send;
//! }
//!
//! impl ClientToBridgeFooMsg {
//!   pub async fn dispatch<H>(self, handler: &H) -> H::Output
//!   where
//!     H: ClientToBridgeFooMsgDispatch + Sync,
//!   {
//!     match self {
//!       Self::Bar => handler.bar().await,
//!       Self::Baz(p) => handler.baz(p).await,
//!     }
//!   }
//! }
//! ```
//!
//! The daemon-side handler implements the trait and the call site
//! collapses to `msg.dispatch(&handler).await`. Variant-name to
//! method-name conversion is PascalCase -> snake_case.
//!
//! Multi-field tuple variants and struct-shaped (`Foo { a, b }`) variants
//! are not supported; the macro errors at compile time.

use proc_macro2::TokenStream as TokenStream2;
use quote::{format_ident, quote};
use syn::{spanned::Spanned, Data, DeriveInput, Fields, Ident};

pub(crate) fn expand(ast: &DeriveInput) -> syn::Result<TokenStream2> {
    let enum_ident = &ast.ident;
    let trait_ident = format_ident!("{}Dispatch", enum_ident);

    let Data::Enum(data) = &ast.data else {
        return Err(syn::Error::new(
            ast.span(),
            "#[derive(BridgeDispatch)] only supports enums",
        ));
    };

    let mut trait_methods = Vec::with_capacity(data.variants.len());
    let mut match_arms = Vec::with_capacity(data.variants.len());

    for variant in &data.variants {
        let method_ident = snake_case_ident(&variant.ident);
        let variant_ident = &variant.ident;

        match &variant.fields {
            Fields::Unit => {
                trait_methods.push(quote! {
          fn #method_ident(&self) -> impl ::core::future::Future<Output = Self::Output> + Send;
        });
                match_arms.push(quote! {
                  Self::#variant_ident => handler.#method_ident().await,
                });
            }
            Fields::Unnamed(unnamed) if unnamed.unnamed.len() == 1 => {
                let payload_ty = &unnamed.unnamed.first().expect("len == 1").ty;
                trait_methods.push(quote! {
          fn #method_ident(&self, params: #payload_ty) -> impl ::core::future::Future<Output = Self::Output> + Send;
        });
                match_arms.push(quote! {
                  Self::#variant_ident(params) => handler.#method_ident(params).await,
                });
            }
            Fields::Unnamed(_) => {
                return Err(syn::Error::new(
                    variant.span(),
                    "#[derive(BridgeDispatch)]: multi-field tuple variants are not supported; \
           wrap the payload in a struct",
                ));
            }
            Fields::Named(_) => {
                return Err(syn::Error::new(
                    variant.span(),
                    "#[derive(BridgeDispatch)]: struct-shaped variants are not supported; \
           wrap the payload in a named struct and use a tuple variant",
                ));
            }
        }
    }

    let trait_doc =
        format!("Dispatcher trait emitted by `#[derive(BridgeDispatch)]` for [`{enum_ident}`].");
    Ok(quote! {
      #[doc = #trait_doc]
      pub trait #trait_ident {
        type Output;
        #(#trait_methods)*
      }

      impl #enum_ident {
        pub async fn dispatch<H>(self, handler: &H) -> H::Output
        where
          H: #trait_ident + ::core::marker::Sync,
        {
          match self {
            #(#match_arms)*
          }
        }
      }
    })
}

fn snake_case_ident(ident: &Ident) -> Ident {
    let mut out = String::new();
    let s = ident.to_string();
    let chars: Vec<char> = s.chars().collect();
    for (i, ch) in chars.iter().enumerate() {
        if ch.is_uppercase() {
            let prev_lower = i > 0 && chars[i - 1].is_lowercase();
            let next_lower = i + 1 < chars.len() && chars[i + 1].is_lowercase();
            if i > 0 && (prev_lower || next_lower) {
                out.push('_');
            }
            for lower in ch.to_lowercase() {
                out.push(lower);
            }
        } else {
            out.push(*ch);
        }
    }
    // Rust raw-identifier escape: a method named `type` etc. needs `r#type`.
    match out.as_str() {
        "type" | "fn" | "match" | "ref" | "self" | "use" | "mod" | "move" | "loop" | "let"
        | "if" | "else" | "for" | "while" | "in" | "do" | "return" | "yield" | "where" | "impl"
        | "trait" | "enum" | "struct" | "const" | "static" | "pub" | "as" | "break"
        | "continue" | "crate" | "extern" | "false" | "true" | "super" => {
            format_ident!("r#{out}")
        }
        _ => Ident::new(&out, ident.span()),
    }
}
