# War-game mode

Practice stack for Pacto Gov: same protocol, accelerated timings, **Sepolia only**. Real governance stays on the production `pacto_gov` singleton and `NavePirataRegistry`.

Public rules: [Wargame](https://covenant-gov.github.io/pacto-app/wargame/) on the download site. Hub channel after first deploy: `squad-wargame`.

## Settled product decisions

These close the research questions in GitHub #138. Do not re-open them as “first-deploy-only” or “replace the live stack.”

**Coexistence.** Parallel throwaway stack on **WarGameRegistry**. It must not occupy the `pacto_gov` SQLite singleton, Launchpad “Deployed,” or production `NavePirataRegistry`. Redeploy retires the previous Active game stack; it does not unwind real gov.

**Config.** Production deploy defaults stay **7 days** crew-change delay / **7 days** proposal expiry / **Majority (51%)** / **3000 bps** quorum. War-game defaults are **5 minutes**, customizable down to **1 minute** (`MIN_GOV_DELAY`). Clients may customize both duration knobs and TA vote mode / quorum. At factory init, `proposalExpiry` also seeds Mutiny `mutinyExpiry` and Quartermaster `crewOffboardExpiry`.

**Copy.** Official name **war-game mode**. Hub slug **`squad-wargame`**. Public tab label **Wargame**. Any member may start; the starter is captain. After deploy, the captain may randomize from Mutiny. Sponsor and Squad Admin deploys have no timing knobs.

## What is not this stack

- Mutiny is always **51% snapshot**, independent of the TA Majority / Quorum switch.
- Crew-led offboard is always **quorum-of-cast** on Quartermaster, independent of that switch.
- Hide/archive of `squad-wargame` and in-app video are out of scope for the first cut.

## App surfaces

| Surface | Role |
|---------|------|
| Status checklist | Encourage “Deploy wargame” before real gov; not a hard gate |
| `squad-wargame` | Virtual hub row (not an MLS group); Sepolia + Active game infra |
| `#announcements` | Deploy / retire / redeploy fan-out so all members sync the row |
| Launchpad | Unchanged production singleton |

Local infra type is `pacto_gov_wargame`. Do not dual-read it as `pacto_gov`.

## Deploy (Sepolia)

`deploy_war_game_for_parent` is member-gated, not captain-gated. It always uses Sepolia, even when the Status tab network is something else.

Sequence: `deployNavePirata` with `stackKind = WarGame` and `squadId = keccak256(parentId)`; then `createWarGameSponsor(parentSquadId, topHatId, WarGameRegistry, [])` with the wizard deposit. The factory does **not** register `parentSquadId`. Live `#dashboard` sponsor is a later Launchpad hats `createSquadSponsor` into that empty parent slot. Do not MLS-announce a parent Ext as live `sponsor`.

War-game-first is intended. Round clones live at `warGameSquadId(parent, round)` and are eligible as **war-game hat wearers** on `WarGameRegistry`. Finish sponsor / Deploy Governance after a war-game must **not** `postInitialize` a parent Ext — the parent slot is empty, so hats `createSquadSponsor` is the live path.

The Active row payload includes `status`, `round`, `gameSquadId`, `sponsor`, hats `variant` (`sponsor`), and optional `retiredSponsor`. Redeploy upserts the same row. War-game UserOps encode `gameSquadId` (factory `warGameSquadId(parent, round)`), not `keccak256(parentId)`. Deploy, redeploy, and retire fan out on `#announcements` as `war_game_updated`. Wargame Treasury binds `payload.sponsor` (the round clone), never a live `sponsor` row. Wargame Treasury, Crew, and deposit/withdraw resolve `factory.squads(gameSquadId)` when the explicit clone is that round address; they never treat `squads(parentKeccak)` as the wargame clone.

The Wargame hub reads role hat IDs from **WarGameRegistry**; live `#dashboard` stays on **NavePirataRegistry**.
