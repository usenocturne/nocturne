build:
    cross build --target=aarch64-unknown-linux-gnu --release --features device

copy: build
    scp target/aarch64-unknown-linux-gnu/release/nocturned root@172.16.42.2:/usr/bin/nocturned

test:
    cargo test --workspace

test-emulator:
    cargo test --workspace --features iap2-rs/emulator

lint:
    cargo clippy --fix --allow-dirty
    cargo fmt

lint-check:
    cargo clippy --workspace -- -D warnings

fmt-check:
    cargo fmt --check

codegen *args:
    cargo run --release -p nocturne-codegen --bin codegen -- {{ args }}

codegen-mirror:
    cargo run --release -p nocturne-codegen --bin codegen -- --mirror

codegen-check:
    cargo run --release -p nocturne-codegen --bin codegen -- --check

codegen-snapshot-review:
    cd tools/codegen && cargo insta review
