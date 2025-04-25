#!/bin/sh -x

docker compose build
docker compose run --rm build
