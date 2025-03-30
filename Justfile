build:
    docker build . -t alpine-builder

# for cap-add and device-cgroup-rule flags:
# https://serverfault.com/questions/701384/loop-device-in-a-linux-container#comment1525331_720496
run: build
    docker run --rm --privileged --cap-add=CAP_MKNOD --device-cgroup-rule="b 7:* rmw" -v ./cache:/cache -v ./output:/output alpine-builder

shell: build
    docker run --rm --privileged -v ./cache:/cache -v ./output:/output -it alpine-builder sh

copy:
    scp output/nocturne_update.img.gz output/nocturne_update.img.gz.sha256 root@172.16.42.2:/root

lint:
    pre-commit run --all-files
