# Development

## Agent skills for testing

The following agent skills are installed at the repo level to help write and review tests across the stack. They are PromptScript-based and do not support global installation, so they live in `.agents/skills/`.

```bash
# Svelte / Vitest unit and integration tests
npx skills add secondsky/claude-skills@vitest-testing -y

# Playwright acceptance / E2E tests
npx skills add bobmatnyc/claude-mpm-skills@playwright -y

# Tauri / Rust desktop application tests
npx skills add bobmatnyc/claude-mpm-skills@desktop-applications -y
```

| Skill | Use for |
| --- | --- |
| `vitest-testing` | Frontend unit and integration tests with Vitest |
| `playwright` | Acceptance / E2E tests across the desktop app |
| `desktop-applications` | Tauri v2 / Rust backend unit and integration tests |
