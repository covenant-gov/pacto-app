---
name: github-pr-closes-issues
description: Formats GitHub closing keywords so each linked issue actually closes. Use when creating or updating a pull request, writing a PR description or GitHub note that closes issues, or running gh pr create with closes/fixes/resolves.
---

# GitHub PR: one `closes` per issue

GitHub auto-close only binds **one issue number per keyword**. Extra `#n` tokens after a single `closes` / `fixes` / `resolves` are ignored, so those issues stay open.

When a PR (or GitHub note/body) closes more than one issue, repeat the keyword.

correct:

```text
closes #n0
closes #n1
```

or:

```text
closes #n0 , closes #n1
```

incorrect:

```text
closes #n0 #n1
```

`#n1` will not get closed.

## Rules

- One keyword + one `#n` per close. Never `closes #n0 #n1`.
- Same for `close`/`closed`, `fix`/`fixes`/`fixed`, `resolve`/`resolves`/`resolved`.
- Put keywords in the **PR description** (or a commit message GitHub will parse). Review comments do not auto-close.
- Prefer one `closes #n` per line. Comma-separated `closes #n0 , closes #n1` is also valid.
