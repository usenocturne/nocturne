build:
    docker build . -t alpine-builder

run: build
    docker run -v ./cache:/cache -v ./output:/output alpine-builder
