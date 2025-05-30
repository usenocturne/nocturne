ssh:
    ssh -i ./resources/id_rsa root@172.16.42.2

install-hooks:
    pre-commit install --install-hooks

lint:
    pre-commit run --all-files