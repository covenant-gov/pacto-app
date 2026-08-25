# Design decisions

Records for **meaning** changes to tokens, shell boundaries, or other design-system contracts.

Value tweaks inside an existing theme file do not need a decision. Renaming or re-purposing a token does.

## Index

| ID | Title |
|----|-------|
| [0001](./0001-theme-token-layers.md) | Theme token layers: `--brand` vs shadcn `--accent` |
| [0002](./0002-shell-data-boundary.md) | Presentational shell vs fixtures vs production stores |
| [0003](./0003-shell-role-notification-tokens.md) | Shell, role, and notification tokens |
| [0004](./0004-identity-avatar-contrast.md) | Identity chips vs default person mark |

## How to add one

1. Copy the next number: `NNNN-short-slug.md`.
2. State context, decision, consequences in plain language.
3. Link it from [THEMING.md](../THEMING.md) or [SHELL.md](../SHELL.md) if those docs change.
4. Do not put tracker IDs in the record body as the main title; keep prose short.
