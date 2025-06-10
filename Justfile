build:
    docker build . -t usenocturne/nocturne-image:latest

# for cap-add and device-cgroup-rule flags:
# https://serverfault.com/questions/701384/loop-device-in-a-linux-container#comment1525331_720496
run: build
    docker run --rm --privileged --cap-add=CAP_MKNOD --device-cgroup-rule="b 7:* rmw" -v ./cache:/cache -v ./output:/output usenocturne/nocturne-image:latest

shell: build
    docker run --rm --privileged -v ./cache:/cache -v ./output:/output -it usenocturne/nocturne-image:latest sh

lint:
    pre-commit run --all-files
