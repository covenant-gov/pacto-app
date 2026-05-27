# Pacto and Modular Politics (ModPol)

Brief alignment note—details will evolve with the product.

## Reference

Schneider, De Filippi, Frey, Tan, Zhang, [*Modular Politics: Toward a Governance Layer for Online Communities*](https://arxiv.org/abs/2005.13701) (arXiv:2005.13701). The paper argues for **modular, composable, portable, interoperable** governance building blocks (drawing on Institutional Analysis and Development), rather than forcing one wholesale “regime” per platform.

## How Pacto maps (loosely)

| ModPol idea | Pacto direction |
|-------------|-----------------|
| **Platform / Instance** | The Pacto client + MLS/Nostr layer hosts squads/networks; **what is binding for in-app behavior** is defined by product policy (not every connector is an ACL source). |
| **Composable modules** | **Governance tools** treated as launchable modules (MVP lens: [Pacto Gov / Nave Pirata](https://github.com/covenant-gov/pacto-gov), Bread Cooperative stub, Gnosis Safe treasury flows). More tools (e.g. Governor Bravo, Moloch-style adapters) are plausible later as **UX connectors** unless explicitly bridged to app permissions. |
| **Orgs / nested arenas** | Squads and networks are the primary **parent**; sub-teams and multiple vaults can coexist; dashboard **Structure** and **Permissions** views will surface on-chain shape where Pacto Gov is deployed. |
| **Interoperability** | Contract repos (e.g. `pacto-gov`) and subgraphs (e.g. Hats) integrate read-paths; announces and DMs remain coordination rails. |

## Pacto Gov’s role

[Pacto Gov](https://github.com/covenant-gov/pacto-gov) is the **in-house** stack for hat-governed roles, treasury procedure (Safe + modules), and **SquadAdmin**-style executor roles (`SquadAdminBase` patterns). It is the natural candidate for **deep integration**—permissions that should survive relay churn and be auditable on-chain.

Other modular gov tools can still ship **in-app UX** (surface proposals, links, read state) without implying they replace Pacto Gov for **product-native permissioning** unless the team adds an explicit bridge later.

## MVP module scope (documentation only)

- **Pacto Gov** — deploy / record Nave Pirata; Structure + Permissions informed by hats / SquadAdmin.
- **Bread Cooperative** — placeholder module until specs land.
- **Safe** — multisig treasury and flows that complement modules above.

This doc does not lock schema or UX names; see `ai-docs/gov-core/` tech specs for concrete implementation steps.
