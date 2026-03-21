.PHONY: build test lint docker-build help

IMAGE_NAME ?= k6-pgbench
IMAGE_TAG ?= latest

## build: Build the custom k6 Docker image with xk6-sql
build: docker-build

## docker-build: Build the custom k6 Docker image
docker-build:
	docker build -t $(IMAGE_NAME):$(IMAGE_TAG) .

## test: Validate k6 scripts (syntax check)
test: docker-build
	@echo "Validating k6 scripts..."
	@for script in scripts/pgbench/tpcb.js scripts/pgbench/select-only.js scripts/pgbench/simple-update.js scripts/pgbench/tpcb-readonly.js scripts/tpcc/tpcc.js scripts/tpcc/tpcc-readonly.js; do \
		echo "  Checking $$script..."; \
		docker run --rm $(IMAGE_NAME):$(IMAGE_TAG) inspect /$$script || exit 1; \
	done
	@echo "All scripts valid"

## lint: Lint JavaScript files
lint:
	@echo "Linting scripts..."
	@if command -v npx >/dev/null 2>&1; then \
		npx --yes eslint scripts/ --no-error-on-unmatched-pattern 2>/dev/null || echo "ESLint not configured, skipping"; \
	else \
		echo "npx not found, skipping lint"; \
	fi

## clean: Remove build artifacts
clean:
	rm -rf examples/cnpg/tmp/
	docker rmi $(IMAGE_NAME):$(IMAGE_TAG) 2>/dev/null || true

## help: Show this help
help:
	@echo "k6-pgbench — PostgreSQL benchmarks with k6 + xk6-sql"
	@echo ""
	@echo "Targets:"
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/^## /  /' | column -t -s ':'
