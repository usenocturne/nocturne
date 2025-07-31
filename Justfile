run:
    sudo ./build.sh

lint:
    pre-commit run --all-files

docker-qemu:
    docker run --rm --privileged multiarch/qemu-user-static --reset -p yes

docker-build:
    docker build -t nocturne-builder .

docker-run: docker-build
    docker run --rm --privileged -v ./output:/work/output nocturne-builder:latest
