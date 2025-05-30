install-hooks:
    pre-commit install --install-hooks

lint:
    pre-commit run --all-files