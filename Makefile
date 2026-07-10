.PHONY: help install dev build preview test validate check lint format rust-test rust-check rust-fmt rust-clippy clean distclean tauri-info signer-key

# Default target shows available commands.
help:
	@echo "Pacto — available make targets"
	@echo ""
	@echo "  install      install Node/Rust dependencies"
	@echo "  dev          run the desktop app in development mode"
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
	@echo "  clean        remove build artifacts and caches"
	@echo "  distclean    deep clean, including node_modules and Cargo targets"
	@echo "  tauri-info   print Tauri environment diagnostics"
	@echo "  signer-key   generate a new Tauri updater signing key"

install:
	pnpm install --frozen-lockfile
	cd src-tauri && cargo fetch

dev:
	pnpm tauri dev

build:
	pnpm tauri build

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

clean:
	rm -rf build
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
