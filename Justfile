build:
    cross build --target=armv7-unknown-linux-gnueabihf --release

copy: build
    scp target/armv7-unknown-linux-gnueabihf/release/nocturned root@172.16.42.2:/usr/bin/nocturned

lint:
    cargo clippy --fix --allow-dirty
    cargo fmt
