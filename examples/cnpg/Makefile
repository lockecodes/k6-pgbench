SCRIPTS_DIR := $(shell pwd)/scripts
THIS_DIR := $(shell pwd)
CONFIGS_DIR := $(shell pwd)/configs

##@ k6-pgbench CNPG Example

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} /^[a-zA-Z_0-9-]+:.*?##/ { printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) }' $(MAKEFILE_LIST)

.PHONY: up
up: cluster ## Start Tilt (builds, deploys, watches for changes)
	tilt up

.PHONY: down
down: ## Stop Tilt and tear down resources
	tilt down

.PHONY: cluster
cluster: ## Ensure k3d cluster + registry are running
	@mkdir -p tmp
	$(SCRIPTS_DIR)/utils.sh ensure-cluster

.PHONY: prune
prune:
	docker system prune -f

.PHONY: clean-cluster
clean-cluster: ## Tear down everything including the k3d cluster
	@CTLPTL=$$(command -v ctlptl 2>/dev/null || echo "$$HOME/.local/bin/ctlptl"); \
	if [ -f tmp/cluster.yaml ]; then $$CTLPTL delete -f tmp/cluster.yaml 2>/dev/null || true; fi

.PHONY: clean
clean: clean-cluster prune ## Tear down everything including the k3d cluster
	@rm -rf tmp/
	@echo "clean"

.PHONY: status
status: ## Show current deployment status
	$(SCRIPTS_DIR)/utils.sh status

##@ Benchmark Scenarios

.PHONY: benchmark
benchmark: cluster ## Run benchmark with a specific scenario: make benchmark SCENARIO=tpcb-default
	@if [ -z "$(SCENARIO)" ]; then \
		echo "Usage: make benchmark SCENARIO=<name>"; \
		echo ""; \
		echo "Available scenarios:"; \
		ls -1 $(CONFIGS_DIR)/*.yaml 2>/dev/null | xargs -I{} basename {} .yaml | sed 's/^/  /'; \
		exit 1; \
	fi
	@if [ ! -f "$(CONFIGS_DIR)/$(SCENARIO).yaml" ]; then \
		echo "Error: scenario '$(SCENARIO)' not found in $(CONFIGS_DIR)/"; \
		exit 1; \
	fi
	@echo "tilt:" > .values.override.yaml
	@echo "  scenario: $(SCENARIO)" >> .values.override.yaml
	@echo "Wrote .values.override.yaml with scenario: $(SCENARIO)"
	tilt up

.PHONY: scenarios
scenarios: ## List available benchmark scenarios
	@echo "Available benchmark scenarios:"
	@echo ""
	@for f in $(CONFIGS_DIR)/*.yaml; do \
		name=$$(basename "$$f" .yaml); \
		desc=$$(head -1 "$$f" | sed 's/^# *//'); \
		printf "  \033[36m%-40s\033[0m %s\n" "$$name" "$$desc"; \
	done
	@echo ""
	@echo "Usage: make benchmark SCENARIO=<name>"
