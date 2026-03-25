# Communities — contributor map

This folder documents **squads** and **in-app networks** together: two product shapes that share the same **MLS + channels** stack.

**Code and storage** use concrete names: types like `Network` / `Squad`, keys like `pacto_networks_<npub>` — this directory is only the **documentation** namespace.

| Concept | What it is |
|---------|------------|
| **Squad** | A group of people in MLS channels; stable identity = **announcements MLS group id**. |
| **Network** (product) | Several squads under one umbrella (`memberSquads`); same MLS mechanics as a squad; needs the **same stable id rule** as squads. |

## Document

| File | Contents |
|------|----------|
| **[DESIGN.md](./DESIGN.md)** | How squads and networks relate, shared identity rule, data shape, persistence, checklist |

## Related

- **MLS / messaging:** [`../mls/`](../mls/), [`../messaging/OVERVIEW.md`](../messaging/OVERVIEW.md)  
- **Code:** grep `Squad`, `Network`, `pacto_squads`, `pacto_networks` in `src/stores/`
