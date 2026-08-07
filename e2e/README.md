# E2E Smoke Tests

These tests drive the **browser-only agent build** (`build-agent/`) with Playwright. They do not exercise the real Tauri backend; backend calls are mocked by `src/lib/api/` shims.

## Run

```bash
pnpm build:agent
pnpm test:e2e:install   # one-time browser install
pnpm test:e2e
```

On failure, Playwright traces and the `test-results/` directory are preserved for inspection.

## CI

The `e2e-ui` job in `.github/workflows/ci.yaml` builds the agent SPA, installs Playwright browsers, and runs this suite on every pull request.
