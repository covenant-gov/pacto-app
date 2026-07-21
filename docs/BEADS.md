# Beads issue tracking

This project uses [Beads](https://beads.gascity.com/) (`bd`) for durable, dependency-aware task tracking. Beads replaces markdown TODOs with a Dolt-backed issue graph that survives thread resets and handoffs.

For the rules agents follow when using Beads, see [`AGENTS.md`](../AGENTS.md).

## Install the CLI

```bash
# macOS / Linux (recommended — also installs dolt, needed for server mode)
brew install beads

# Node.js users (note: does not install dolt; install dolt separately if using server mode)
npm install -g @beads/bd
```

Other install methods: [Beads installation guide](https://github.com/gastownhall/beads/blob/main/docs/getting-started/installation.md).

## Project setup (this repo)

This repo is already initialized in **server mode**. The local database lives in `.beads/dolt/` and the Dolt server is running on `127.0.0.1:57532`.

Sync target:

```text
Remote: https://doltremoteapi.dolthub.com/opselite/pacto-app
Web UI: https://www.dolthub.com/repositories/opselite/pacto-app
```

If you are setting up a fresh clone and `bd` is already installed, run:

```bash
bd bootstrap
```

Then pull the latest beads data:

```bash
bd dolt pull
```

To check the backend status:

```bash
bd context
bd ping
```

## Setting up a new project

Only use this if you are creating a brand-new Beads workspace, not for cloning this repo.

1. **Initialize Beads** in the project root:

   ```bash
   cd your-project
   bd init
   ```

   - `bd init` (embedded mode): Dolt runs in-process; data lives in `.beads/embeddeddolt/`. Best for single users.
   - `bd init --server` (server mode): Dolt runs as a local `sql-server`; data lives in `.beads/dolt/`. Best for multiple agents or concurrent writers. **This repo uses server mode.**

2. **Add a DoltHub remote** so the database can sync:

   ```bash
   bd dolt remote add origin https://doltremoteapi.dolthub.com/OWNER/REPO
   bd config set sync.remote https://doltremoteapi.dolthub.com/OWNER/REPO
   ```

3. **Push the initial database**:

   ```bash
   bd dolt push
   ```

## Daily workflow

Find work ready to start:

```bash
bd ready
```

Claim and work on an issue:

```bash
bd show <id>
bd update <id> --claim
```

Create a new task or follow-up:

```bash
bd create "Short title" --description="Why this exists and what needs to be done" --type=task --priority=2
```

Close completed work:

```bash
bd close <id> --reason="Done"
```

Refresh context after a session reset:

```bash
bd prime
```

## Sync

Push your beads changes to DoltHub so others can see them:

```bash
bd dolt push
```

Pull changes from teammates:

```bash
bd dolt pull
```

Normal `git push` does **not** sync beads data. Beads lives in a separate Dolt ref.

## Learn more

- [Beads docs](https://beads.gascity.com/)
- [Essential commands](https://github.com/gastownhall/beads/blob/main/README.md#-essential-commands)
- [Sync concepts](https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md)
- [Config reference](https://github.com/gastownhall/beads/blob/main/docs/reference/config.md)
