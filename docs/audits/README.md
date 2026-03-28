# Audits and security assurance

## Warning — no independent audit

**Pacto’s wallet, cryptography, and key-handling code have not been reviewed by an independent third-party security audit.** The project may ship **alpha-grade** builds with **risk disclaimers** so users understand that funds and secrets could be lost due to bugs, implementation errors, or yet-unknown vulnerabilities.

This is **not** a statement that the software is insecure; it is a statement that **formal assurance** (e.g. paid audit, formal verification) is **not** currently planned. Treat all releases accordingly until policy changes.

## What users should assume

- Use only **amounts they can afford to lose** on experimental features.
- Prefer **small balances** and **testnets** when validating behavior.
- Read wallet and network docs under [`docs/wallet/`](../wallet/README.md) for chain- and feature-specific notes.

## Maintainers

- If an audit is commissioned later, add a dated summary or link here; do not remove this file’s historical “no audit” context without an explicit decision record elsewhere in `docs/`.
