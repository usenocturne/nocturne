ssh:
    ssh -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no root@172.16.42.2

install-hooks:
    pre-commit install --install-hooks

lint:
    pre-commit run --all-files