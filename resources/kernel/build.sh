#!/bin/sh -x

sudo rm -rf ./output
mkdir -p ./output

docker compose build
docker compose run --rm build
