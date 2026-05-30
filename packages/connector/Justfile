connector-api:
    cd src && bun install && bun run check && bun run build

run: connector-api
    sudo ./build.sh

lint:
    pre-commit run --all-files

docker-qemu:
    docker run --rm --privileged multiarch/qemu-user-static --reset -p yes

docker-build:
    docker build -t nocturne-connector-builder .

docker-run: docker-build
    docker run --rm --privileged -v "$PWD/output:/work/output" -v "$PWD/cache:/work/cache" nocturne-connector-builder

