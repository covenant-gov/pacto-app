# 0004 — Identity chips vs default person mark

## Context

`.identity-fill` used to retarget from `color-scheme`, which flipped letters dark on dark fills in Techno. A later pass put `user-placeholder.svg` (hardcoded mint silhouette) on every face. That mark does not follow `--brand`, so Midnight looked like a mint sticker on violet.

## Decision

1. **Chat, rail, member, poll faces** use letter chips. Fill is `--identity` washed with `--brand`. Glyph is a light mix toward `--brand`. It does not follow `--foreground` or `color-scheme`.
2. **`user-placeholder.svg`** is the DM / no-photo silhouette only. Do not use it as the default face in the shell playground.
3. Avatar rings are a quiet border. Do not `mix-blend` the overlay over identity fills.

## Consequences

Techno and Midnight both keep readable letters. Skins tint chips (cyan vs magenta) without a generic green person. Squad tiles share the same wash so rail and faces match.
