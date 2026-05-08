connector-api:
    cd src && bun install && bun run check && bun run build

run: connector-api
    sudo ./build.sh

lint:
    pre-commit run --all-files

docker-qemu:
    docker run --rm --privileged multiarch/qemu-user-static --reset -p yes
