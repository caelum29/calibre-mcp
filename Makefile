# Calibre MCP — dev convenience targets. The .mcpb bundle lands in dist-mcpb/.
.DEFAULT_GOAL := help
.PHONY: help mcpb mcpb-open test typecheck build

help: ## List targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

mcpb: ## Build the Claude Desktop bundle → dist-mcpb/calibre-mcp-<version>.mcpb
	pnpm pack:mcpb

mcpb-open: mcpb ## Build the bundle, then open it (installs into Claude Desktop)
	open dist-mcpb/calibre-mcp-*.mcpb

build: ## Compile TypeScript → dist/
	pnpm build

typecheck: ## Type-check without emitting
	pnpm typecheck

test: ## Run the test suite
	pnpm test