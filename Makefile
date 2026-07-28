.PHONY: help install dev dev-sandbox dev-account dev-buddy build preview test validate check lint format rust-test rust-check rust-fmt rust-clippy clean distclean tauri-info signer-key e2e e2e-install e2e-tauri release-symbol-check

# Default target shows available commands.
help:
	@echo "Pacto — available make targets"
	@echo ""
	@echo "  install      install Node/Rust dependencies"
	@echo "  dev          run the desktop app in development mode"
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

dev:
	pnpm tauri dev

# Isolated sandbox account for agent-driven MCP verification (docs/TAURI_MCP_INTEGRATION.md).
# Avoids colliding with a real dev account whose PIN nobody remembers.
dev-sandbox:
	@mkdir -p test_sandbox
	PACTO_TEST_SANDBOX_ROOT="$(CURDIR)/test_sandbox/manual-$(shell date +%s)" PACTO_ALLOW_TEST_AUTH=1 pnpm tauri dev

# Persistent reusable test identities (docs/TAURI_MCP_INTEGRATION.md). Unlike
# dev-sandbox, these keep the same PIN-protected account, DM history, and
# squad membership across relaunches. Not swept by `make clean`; delete
# test_fixtures/ manually to reset.
dev-account:
	@mkdir -p test_fixtures
	PACTO_TEST_SANDBOX_ROOT="$(CURDIR)/test_fixtures/dev-account" pnpm tauri dev

dev-buddy:
	@mkdir -p test_fixtures
	PACTO_TEST_SANDBOX_ROOT="$(CURDIR)/test_fixtures/dev-buddy" pnpm tauri dev

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
