//! Casing helpers shared by dispatch emitters.

pub fn snake_to_camel(s: &str) -> String {
    let mut segments = non_empty_segments(s);
    let Some(first) = segments.next() else {
        return String::new();
    };

    let mut out = String::with_capacity(s.len());
    out.push_str(first);
    for segment in segments {
        push_capitalized(&mut out, segment);
    }
    out
}

pub fn snake_to_pascal(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for segment in non_empty_segments(s) {
        push_capitalized(&mut out, segment);
    }
    out
}

pub fn snake_to_kebab(s: &str) -> String {
    non_empty_segments(s).collect::<Vec<_>>().join("-")
}

/// Splits before every uppercase character. This is invertible for
/// lower-snake inputs whose segments are lowercase ASCII words or digits,
/// but acronym-style inputs intentionally become one segment per capital
/// (`HTTPServer` -> `h_t_t_p_server`).
pub fn camel_to_snake(s: &str) -> String {
    mixed_case_to_snake(s)
}

pub fn pascal_to_snake(s: &str) -> String {
    mixed_case_to_snake(s)
}

fn non_empty_segments(s: &str) -> impl Iterator<Item = &str> {
    s.split('_').filter(|segment| !segment.is_empty())
}

fn push_capitalized(out: &mut String, segment: &str) {
    let mut chars = segment.chars();
    let Some(first) = chars.next() else {
        return;
    };
    out.extend(first.to_uppercase());
    out.push_str(chars.as_str());
}

fn mixed_case_to_snake(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        if ch.is_uppercase() {
            if !out.is_empty() {
                out.push('_');
            }
            out.extend(ch.to_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::{collection::vec, prelude::*, test_runner::Config};

    #[test]
    fn snake_to_camel_handles_basic_cases() {
        assert_eq!(snake_to_camel(""), "");
        assert_eq!(snake_to_camel("foo"), "foo");
        assert_eq!(snake_to_camel("foo_bar_baz"), "fooBarBaz");
    }

    #[test]
    fn snake_to_camel_ignores_empty_segments() {
        assert_eq!(snake_to_camel("foo__bar"), "fooBar");
        assert_eq!(snake_to_camel("_foo"), "foo");
        assert_eq!(snake_to_camel("foo_"), "foo");
        assert_eq!(snake_to_camel("_foo__bar_"), "fooBar");
    }

    #[test]
    fn snake_to_pascal_handles_basic_cases() {
        assert_eq!(snake_to_pascal(""), "");
        assert_eq!(snake_to_pascal("foo"), "Foo");
        assert_eq!(snake_to_pascal("foo_bar_baz"), "FooBarBaz");
    }

    #[test]
    fn snake_to_pascal_ignores_empty_segments() {
        assert_eq!(snake_to_pascal("foo__bar"), "FooBar");
        assert_eq!(snake_to_pascal("_foo"), "Foo");
        assert_eq!(snake_to_pascal("foo_"), "Foo");
        assert_eq!(snake_to_pascal("_foo__bar_"), "FooBar");
    }

    #[test]
    fn snake_to_kebab_handles_basic_cases() {
        assert_eq!(snake_to_kebab(""), "");
        assert_eq!(snake_to_kebab("foo"), "foo");
        assert_eq!(snake_to_kebab("foo_bar_baz"), "foo-bar-baz");
    }

    #[test]
    fn snake_to_kebab_ignores_empty_segments() {
        assert_eq!(snake_to_kebab("foo__bar"), "foo-bar");
        assert_eq!(snake_to_kebab("_foo"), "foo");
        assert_eq!(snake_to_kebab("foo_"), "foo");
        assert_eq!(snake_to_kebab("_foo__bar_"), "foo-bar");
    }

    #[test]
    fn inverses_use_one_underscore_per_uppercase_boundary() {
        assert_eq!(camel_to_snake("fooBarBaz"), "foo_bar_baz");
        assert_eq!(pascal_to_snake("FooBarBaz"), "foo_bar_baz");
        assert_eq!(pascal_to_snake("HTTPServer"), "h_t_t_p_server");
    }

    fn canonical_snake() -> impl Strategy<Value = String> {
        vec("[a-z][a-z0-9]{0,12}", 1..16).prop_map(|segments| segments.join("_"))
    }

    proptest! {
      #![proptest_config(Config { cases: 10_000, ..Config::default() })]

      #[test]
      fn camel_round_trips_canonical_snake(s in canonical_snake()) {
        prop_assert_eq!(camel_to_snake(&snake_to_camel(&s)), s);
      }

      #[test]
      fn pascal_round_trips_canonical_snake(s in canonical_snake()) {
        prop_assert_eq!(pascal_to_snake(&snake_to_pascal(&s)), s);
      }

      #[test]
      fn kebab_matches_snake_separator_for_canonical_snake(s in canonical_snake()) {
        prop_assert_eq!(snake_to_kebab(&s), s.replace('_', "-"));
      }
    }
}
