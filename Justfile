build:
    docker build . -t alpine-builder

run: build
    docker run --rm --privileged -v ./cache:/cache -v ./output:/output alpine-builder

lint:
    pre-commit run --all-files
