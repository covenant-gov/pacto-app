# 0003 — Shell, role, and notification tokens

## Context

The `/design` shell and chat surfaces needed colors that were not in the required Pacto token list: rail background, sidebar user strip, notification badge text, governance avatar fill, hat/role names, mention chips, and text on success fills. Those values were hardcoded in route CSS.

## Decision

1. Every theme file owns these tokens as hex: `--notif`, `--on-notif`, `--on-success`, `--shell-rail-bg`, `--user-strip-bg`, `--gov-avatar-bg`, `--role-quartermaster`, `--role-community-manager`, `--mention-accent`, `--danger-muted-fg`.
2. `src/app.css` maps them into Tailwind `--color-*` names. shadcn aliases stay unchanged (`--accent` remains hover).
3. Badge/button variants consume those Tailwind names (`bg-notif`, `text-on-success`, etc.).

## Consequences

Theme-token tests require the new hex tokens and contrast for `--on-notif` on `--notif` and `--on-success` on `--success`. Product UI must not hardcode those fills. `--notif` follows that skin’s `--danger`; do not reuse a single orange across themes.
