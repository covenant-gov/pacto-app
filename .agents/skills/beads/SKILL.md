---
name: beads
description: Use when working in a repository that uses bd or Beads for durable project task tracking, issue dependencies, blocker management, multi-session handoff, or shared work memory. Trigger when the user asks to find ready work, claim or close tasks, create follow-up work, inspect blockers, recover project context, or choose between local planning and persistent project tracking.
---

# Beads

Use Beads as the shared project task system. Local plans, scratch files, and personal memories are useful, but they are not the durable source of truth for project work.

## First Step

Run:

```bash
bd prime
```

If that prints nothing, check whether the repository has an active Beads workspace:

```bash
bd where
```

## Preferred Route

Use the `bd` CLI when shell access is available. It is the most compact and direct Beads interface.

## Core CLI Workflow

1. Find work:

```bash
bd ready
bd list --status=open
bd list --status=in_progress
```

2. Inspect before editing:

```bash
bd show <id>
```

3. Claim work atomically:

```bash
bd update <id> --claim
```

4. Create durable follow-up work when implementation reveals new tasks:

```bash
bd create "Short title" --description="Why this exists and what needs to be done" --type=task --priority=2
```

5. Close completed work:

```bash
bd close <id> --reason="Completed"
```

## Wiring Dependencies

Two forms, **opposite directions**. Inverting them builds a graph that `bd ready` then reports confidently and wrongly.

| Form | Meaning |
|---|---|
| `bd dep add A B` | A depends on B |
| `bd create X --deps <id>` | X depends on `<id>` |
| `bd create X --deps blocks:<id>` | X **blocks** `<id>` — inverse |

Use a bare id, or wire after creation with `bd dep add <blocked> <blocker>`. Both read "depends on". Avoid `blocks:` inside `--deps`.

Correcting a graph in bulk: remove **every** wrong edge before adding any correct one. Interleaving remove/add per edge trips a spurious `would create a cycle` error, because the inverted edges still in place close the loop.

Verify every time — this is what actually catches an inversion:

```bash
bd ready
```

The task intended to start first must be the only ready item in that group.

## What Belongs In Beads

Use Beads for:

- shared project tasks
- blockers and dependencies
- discovered follow-up work
- work that must survive thread reset, compaction, or handoff
- status that another person or agent should be able to resume

Use agent-local planning tools only for the current turn's execution checklist. Do not treat them as shared project state.

## Rules

- Do not create markdown TODO files as the source of truth when Beads is available.
- Do not use `bd edit`; it opens an interactive editor. Use `bd update` flags instead.
- Prefer `--json` when parsing `bd` output programmatically.
- If hooks are installed, `bd prime` may already be injected. Run it manually when context is missing.
- Do not auto-close or mutate tasks unless the work is actually complete.
- After wiring dependencies, confirm with `bd ready` that the intended first task is the only ready one. An inverted graph fails silently.
