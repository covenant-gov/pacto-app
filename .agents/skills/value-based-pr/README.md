# Value-Based PR Writing Skill

> Write PR titles and descriptions that explain value, not just file changes.

| | |
|---|---|
| **Status** | Active |
| **Version** | 1.0.0 |
| **Last Updated** | 2026-07-07 |
| **Confidence** | 4/5 |

## What This Skill Does

Provides a concise framework for writing PR titles and descriptions that answer "what changed and why it matters" rather than "what files were touched." Helps reviewers understand intent before they open the diff.

## Auto-Trigger Keywords

### Primary Keywords
- "create a PR"
- "open a pull request"
- "write a PR description"
- "value-based PR"
- "PR title"

### Secondary Keywords
- "commit and PR"
- "ship this"
- "update PR description"
- "review PR description"

## When to Use

- Creating a new PR from local commits.
- Rewriting or updating an existing PR description.
- Reviewing a PR title/body for clarity before submitting.
- Any PR for user-facing, behavioral, or build-tooling changes.

## Don't Use For

- Commit messages only (no PR description needed).
- Internal documentation-only PRs that already have a clear audience note.
- Automated or generated release notes that follow a different template.

## Quick Usage

1. Read the branch diff.
2. Identify the value: what is now possible or fixed that was not before.
3. Write a title under 72 characters using conventional-commit style.
4. Write a one-paragraph summary with before/after when the change is user-facing.
5. List only high-level changes and a specific test plan.
6. Add evidence only for observable behavior; include the badge at the end.

## File Structure

```
value-based-pr/
├── SKILL.md    # Rules, examples, and body template
└── README.md   # This file - discovery and quick reference
```

## Related Skills

- `ce-commit-push-pr` — full commit, push, and PR creation workflow.
- `ce-demo-reel` — capture screenshots and recordings for PR evidence.
