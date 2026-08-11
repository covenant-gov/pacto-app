.PHONY: help install dev dev-sandbox dev-account dev-buddy build preview test validate check lint format rust-test rust-check rust-fmt rust-clippy new-migration e2e e2e-install e2e-tauri release-symbol-check clean distclean tauri-info signer-key

# Default target shows available commands.
help:
	@echo "Pacto — available make targets"
	@echo ""
	@echo "  install      install Node/Rust dependencies"
	@echo "  dev          run the desktop app in development mode (auto-isolated per branch, except main)"
	@echo "  dev-sandbox  run the desktop app against a throwaway account for MCP-driven UI verification"
	@echo "  dev-account  run the desktop app against the persistent, reusable primary test account"
	@echo "  dev-buddy    run the desktop app against the persistent, reusable secondary test account"
	@echo "  build        build production frontend + Tauri app"
	@echo "  preview      serve the built static frontend (no Tauri shell)"
	@echo ""
	@echo "  test         run frontend and backend test suites"
	@echo "  validate     run all local quality gates (lint, typecheck, tests, rust checks)"
	@echo "  check        typecheck the SvelteKit frontend"
	@echo "  lint         lint the frontend with ESLint"
	@echo "  format       format frontend and Rust sources"
	@echo ""
	@echo "  rust-test    run cargo test in src-tauri"
	@echo "  rust-check   cargo check the Rust backend"
	@echo "  rust-fmt     format Rust sources with rustfmt"
	@echo "  rust-clippy  lint Rust sources with clippy"
	@echo "  new-migration  create a new UTC-timestamp-versioned refinery migration file (name=<snake_case_description>)"
	@echo ""
	@echo "  e2e          run Playwright smoke tests against the agent build"
	@echo "  e2e-install  install Playwright browsers"
	@echo "  e2e-tauri    run the real-Tauri MCP-driven end-to-end harness"
	@echo "  release-symbol-check  verify release binary has no debug-only symbols"
	@echo ""
	@echo "  clean        remove build artifacts and caches"
	@echo "  distclean    deep clean, including node_modules and Cargo targets"
	@echo "  tauri-info   print Tauri environment diagnostics"
	@echo "  signer-key   generate a new Tauri updater signing key"

install:
	pnpm install --frozen-lockfile
	cd src-tauri && cargo fetch

# Persistent per-branch data dir, so switching branches with different DB
# migrations never trips the storage-format update gate (a newer branch's
# schema blocking an older one, or vice versa). `main` keeps the real,
# stable account at the OS-default location with today's exact ports;
# every other branch gets its own isolated, persistent test_fixtures/ dir
# and its own branch-hashed port set (scripts/dev-ports.mjs) so parallel
# worktrees never collide on ports either. Not swept by `make clean`;
# delete test_fixtures/ manually to reset.
dev:
	@branch=$$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo detached); \
	if [ "$$branch" = "main" ]; then \
		pnpm tauri dev; \
	else \
		slug=$$(node -e "import('./scripts/dev-ports.mjs').then(m => process.stdout.write(m.slugForBranch(process.argv[1])))" "$$branch"); \
		eval "$$(node scripts/dev-ports.mjs --export --branch "$$branch")"; \
		mkdir -p test_fixtures; \
		echo "make dev: branch '$$branch' -> port index $$PACTO_DEV_PORT_INDEX, isolated data dir test_fixtures/dev-branch-$$slug"; \
		echo "  devServer=$$PACTO_DEV_PORT hmr=$$PACTO_DEV_HMR_PORT mcpBridge=$$PACTO_MCP_BRIDGE_PORT"; \
		PACTO_TEST_SANDBOX_ROOT="$(CURDIR)/test_fixtures/dev-branch-$$slug" \
		pnpm tauri dev --config '{"build":{"devUrl":"http://localhost:'"$$PACTO_DEV_PORT"'"}}'; \
	fi

# Isolated sandbox account for agent-driven MCP verification (docs/TAURI_MCP_INTEGRATION.md).
# Avoids colliding with a real dev account whose PIN nobody remembers. Port
# set is resolved the same way as `dev` so a concurrent dev-sandbox run
# never collides with it or with another worktree's `dev`.
dev-sandbox:
	@mkdir -p test_sandbox
	@eval "$$(node scripts/dev-ports.mjs --export --branch dev-sandbox)"; \
	echo "make dev-sandbox: port index $$PACTO_DEV_PORT_INDEX -> devServer=$$PACTO_DEV_PORT hmr=$$PACTO_DEV_HMR_PORT mcpBridge=$$PACTO_MCP_BRIDGE_PORT"; \
	PACTO_TEST_SANDBOX_ROOT="$(CURDIR)/test_sandbox/manual-$(shell date +%s)" PACTO_ALLOW_TEST_AUTH=1 \
	pnpm tauri dev --config '{"build":{"devUrl":"http://localhost:'"$$PACTO_DEV_PORT"'"}}'

# Persistent reusable test identities (docs/TAURI_MCP_INTEGRATION.md). Unlike
# dev-sandbox, these keep the same PIN-protected account, DM history, and
# squad membership across relaunches. Not swept by `make clean`; delete
# test_fixtures/ manually to reset.
dev-account:
	@mkdir -p test_fixtures
	@eval "$$(node scripts/dev-ports.mjs --export --branch dev-account)"; \
	echo "make dev-account: port index $$PACTO_DEV_PORT_INDEX -> devServer=$$PACTO_DEV_PORT hmr=$$PACTO_DEV_HMR_PORT mcpBridge=$$PACTO_MCP_BRIDGE_PORT"; \
	PACTO_TEST_SANDBOX_ROOT="$(CURDIR)/test_fixtures/dev-account" \
	pnpm tauri dev --config '{"build":{"devUrl":"http://localhost:'"$$PACTO_DEV_PORT"'"}}'

dev-buddy:
	@mkdir -p test_fixtures
	@eval "$$(node scripts/dev-ports.mjs --export --branch dev-buddy)"; \
	echo "make dev-buddy: port index $$PACTO_DEV_PORT_INDEX -> devServer=$$PACTO_DEV_PORT hmr=$$PACTO_DEV_HMR_PORT mcpBridge=$$PACTO_MCP_BRIDGE_PORT"; \
	PACTO_TEST_SANDBOX_ROOT="$(CURDIR)/test_fixtures/dev-buddy" \
	pnpm tauri dev --config '{"build":{"devUrl":"http://localhost:'"$$PACTO_DEV_PORT"'"}}'

build:
	# Tauri CLI 2.9.x misinterprets CI=1 as --ci=1 (boolean flags only accept
	# true/false), so unset CI and pass --ci explicitly to skip prompts.
	env -u CI pnpm tauri build --ci

preview:
	pnpm preview

test:
	pnpm test
	cd src-tauri && cargo test --no-default-features

validate: lint check test rust-clippy rust-check

check:
	pnpm check

lint:
	pnpm lint

format: rust-fmt
	@echo "Frontend formatting is handled by ESLint; run 'make lint' to verify."
	cd src-tauri && cargo fmt

rust-test:
	cd src-tauri && cargo test --no-default-features

rust-check:
	cd src-tauri && cargo check

rust-fmt:
	cd src-tauri && cargo fmt

rust-clippy:
	cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings

# Creates a new refinery migration file with the UTC-timestamp version
# convention (AGENTS.md), so nobody hand-types a filename and drifts back
# to the sequential numbering that collides across parallel branches.
# Touches mod.rs afterward because refinery's embed_migrations! macro reads
# the directory at compile time with no cargo:rerun-if-changed tracking --
# without it, `cargo test`/`cargo build` can silently reuse a cached build
# that never saw the new file.
# Usage: make new-migration name=dm_deletion_cutoffs
new-migration:
	@if [ -z "$(name)" ]; then \
		echo "Usage: make new-migration name=<snake_case_description>"; \
		exit 1; \
	fi
	@slug=$$(printf '%s' "$(name)" | tr '[:upper:] ' '[:lower:]_' | tr -c 'a-z0-9_' '_' | tr -s '_' | sed 's/^_//; s/_$$//'); \
	if [ -z "$$slug" ]; then \
		echo "name must contain at least one alphanumeric character"; \
		exit 1; \
	fi; \
	version=$$(date -u +%Y%m%d%H%M%S); \
	file="src-tauri/src/migrations/V$${version}__$${slug}.sql"; \
	if [ -e "$$file" ]; then \
		echo "$$file already exists (two migrations in the same second) -- rerun make new-migration"; \
		exit 1; \
	fi; \
	: > "$$file"; \
	touch src-tauri/src/migrations/mod.rs; \
	echo "created $$file"

e2e:
	pnpm build:agent
	pnpm test:e2e

e2e-install:
	pnpm test:e2e:install

e2e-tauri:
	pnpm test:e2e:tauri

release-symbol-check:
	./scripts/check-release-symbols.sh

clean:
	rm -rf build build-agent test-results test_sandbox
	cd src-tauri && cargo clean

distclean: clean
	rm -rf node_modules
	rm -rf src-tauri/target
	rm -rf .svelte-kit
	rm -rf coverage

tauri-info:
	pnpm tauri info

signer-key:
	pnpm tauri signer generate
