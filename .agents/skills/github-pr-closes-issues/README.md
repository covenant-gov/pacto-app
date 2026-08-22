# GitHub PR closing-keyword skill

> Each GitHub issue needs its own `closes` / `fixes` / `resolves` keyword, or later issues stay open.

| | |
|---|---|
| **Status** | Active |
| **Version** | 1.0.0 |

## Auto-Trigger Keywords

- "create a PR" / "open a pull request" / `gh pr create`
- "closes #" / "fixes #" / "resolves #"
- "close multiple issues"
- "PR description" / "PR body"

## When to Use

Writing or updating a GitHub PR description (or parsed commit message) that should close more than one issue.

## Don't Use For

- Single-issue PRs (`closes #n` is enough)
- Review comments (GitHub does not auto-close from comments)

## Related Skills

- `value-based-pr` — PR title and body value, not file lists
