build:
    docker build . -t alpine-builder

run: build
    docker run --rm --privileged -v ./cache:/cache -v ./output:/output alpine-builder

shell: build
    docker run --rm --privileged -v ./cache:/cache -v ./output:/output -it alpine-builder sh

lint:
    pre-commit run --all-files
