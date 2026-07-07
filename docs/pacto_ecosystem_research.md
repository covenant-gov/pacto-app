# Pacto Ecosystem Research Summary

**Organization:** `covenant-gov`  
**Main Repository:** `pacto-app`  
**Date Researched:** June 2026

---

## Table of Contents

1. [The Five Ws](#the-five-ws)
2. [Parent Organization: covenant-gov](#parent-organization-covenant-gov)
3. [Subprojects](#subprojects)
4. [Integration Architecture](#integration-architecture)
5. [The "Why" — Plain English](#the-why--plain-english)
6. [Key Integration Points](#key-integration-points)
7. [Glossary of Terms](#glossary-of-terms)

---

## The Five Ws

### What
Pacto is a **private, censorship-resistant, and governable community organizing platform** that requires no KYC (identity verification). It combines encrypted messaging with blockchain governance and financial tools. It features end-to-end encrypted DMs, private community "Squads" (like Discord/Slack channels), and "Networks" (inter-organizational hubs). It also includes a modular governance platform, a Safe Wallet for collective treasury management, and embedded wallets that work out of the box.

### Who
Pacto is built by **covenant-gov** (the GitHub organization). It is a fork of **Vector**, a private decentralized messenger built on Nostr. The project targets communities, activists, DAOs, or any group that needs private, uncensorable coordination with on-chain governance and financial capabilities.

### Where
The project lives on GitHub at `github.com/covenant-gov/pacto-app`. It is a cross-platform application (Ubuntu, macOS, Windows) that runs as a decentralized client. Communications route through **Nostr relays** (a distributed, censorship-resistant network), while governance and financial operations execute on **EVM-compatible blockchains** (Ethereum) or the **Aztec** privacy-focused blockchain.

### When
Pacto is an active work-in-progress project (the architecture diagram is still marked as WIP). It exists in the current wave of post-2023 privacy and decentralization tooling, riding the momentum of Nostr's growth and the demand for zero-knowledge privacy in blockchain applications.

### Why
The core motivation is to solve a critical gap: existing platforms force a trade-off between **privacy** and **enforceability**. Social platforms offer privacy but no governance; blockchains offer governance but poor privacy. Pacto aims to give communities **both** — private, metadata-protected communications (via Nostr's NIP-17, NIP-44, NIP-59 standards and MLS group encryption) combined with **governable, scarce resources** (votes, treasury) enforced by zero-knowledge proofs on Ethereum or Aztec. The goal is to let people organize, vote, and manage money collectively without exposing their identities or activities to censorship or surveillance.

---

## Parent Organization: covenant-gov

**Covenant Gov** is a GitHub organization building **Pacto** — a privacy-first, censorship-resistant, governable community platform. The org operates under a pseudonymous, no-KYC philosophy and uses a "pirate ship" governance metaphor ("Nave Pirata") for its on-chain squad mechanics. The entire stack is designed to let communities **communicate privately** (via Nostr), **govern transparently** (via EVM/Hats Protocol), and **act privately** (via Aztec ZK) — all from a single identity root.

The organization has **9 public repositories** spanning Rust, Solidity, Noir, and JavaScript.

---

## Subprojects

### 1. `pacto-app` (Rust / Tauri)
The flagship desktop application. Cross-platform (Windows, macOS, Ubuntu).

**Features:**
- E2EE Direct Messaging (NIP-17 private DMs)
- **Squads** — private Discord/Slack-style community hubs with text channels
- **Networks** — inter-organizational coordination (Squad of Squads)
- **Embedded wallets** — zero-configuration crypto wallets
- **Web3-integrated dashboard widgets**

**Fork origin:** Forks the **Vector** messenger (Rust backend) for MLS group messaging.

---

### 2. `pacto-gov` — "Nave Pirata" (Solidity)
The core governance engine. Every squad deploys a "pirate ship" — a Hats Protocol-governed mesh of role contracts sitting atop a **Gnosis Safe**. Deployed via a one-shot factory.

**Key contracts:**
| Contract | Purpose |
|----------|---------|
| `Quartermaster` | Timelocked crew roster; admin of the crew hat |
| `MutinyModule` | 51% crew vote can replace the captain (or captain can resign) |
| `TreasuryAuthority` | Two-body democracy: crew vote + captain approval required for spending |
| `SquadAdmin` | Captain-gated on-chain executor roles for app integrations |
| `NavePirataFactory` | Atomic one-shot deployment of Safe + hat tree + clones + wiring |
| `AssetRescuer` | Permissionless sweep of accidentally-received assets |

**Why it matters:** On-chain governance prevents "organizational amnesia" if relays go down. Roles, votes, and permissions are tamper-evident and replayable.

---

### 3. `pacto-squad-sponsor` (Solidity)
A squad-scoped **gas fee sponsorship** contract. It lets squads subsidize transaction costs for their members, removing the "you need ETH to do anything" barrier for new users.

---

### 4. `pacto-aztec` (Noir / TypeScript)
Aztec privacy layer. Uses **Noir** (ZK language) to build private smart contracts for:
- **Private voting** — votes cast without revealing choice or voter
- **Private payments** — shielded transfers
- **Private-to-public execution** — private functions enqueue public state updates

Includes automated benchmarking (Gates, DA Gas, L2 Gas) via GitHub Actions and auto-generated TypeScript bindings.

---

### 5. `nostr-k-derivs` (Rust)
**Key derivation bridge.** Derives Ethereum and Aztec cryptographic keys directly from a **Nostr nsec/npub**. This creates a single identity root:
- One Nostr keypair → multiple chain addresses
- No separate wallet setup required
- Enables the "embedded wallet" experience in `pacto-app`

---

### 6. `delegated-security-manager` (Solidity)
A **multi-layer on-chain security module** leveraging **Hats Protocol**. It provides:
- Role-based access control delegation
- Formal verification readiness (Halmos / Medusa tooling)
- Defense-in-depth for squad treasuries and admin functions

---

### 7. `contributor-pool` (Solidity) — ARCHIVED
A staking pool for coordinating open-source development. Contributors stake tokens, complete work, and receive **autonomous payouts** based on on-chain coordination. It served as the project's own dogfooding mechanism for decentralized labor.

---

### 8. `pacto-download` (JavaScript)
Simple distribution website for the desktop app. Handles installer delivery and release management.

---

### 9. `.github`
Organization templates, contribution norms, issue/PR templates, and community participation guidelines.

---

## Integration Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1: USER INTERFACE                                        │
│  ┌──────────────┐  ┌──────────────┐                             │
│  │ pacto-app    │  │ pacto-      │                             │
│  │ (Rust/Tauri) │  │ download    │                             │
│  │ E2EE DMs,    │  │ (JS)        │                             │
│  │ Squads,      │  │ Distribution│                             │
│  │ Networks     │  │ Portal      │                             │
│  └──────┬───────┘  └─────────────┘                             │
└─────────┼─────────────────────────────────────────────────────────┘
          │ E2EE msgs
┌─────────▼─────────────────────────────────────────────────────────┐
│  LAYER 2: COMMUNICATION (NOSTR)                                   │
│  ┌────────────────────────────┐  ┌──────────────────────────┐   │
│  │ Nostr Protocol             │  │ nostr-k-derivs           │   │
│  │ Decentralized relays       │  │ Key Derivation (Rust)    │   │
│  │ NIP-17, NIP-44, NIP-59    │  │ Nostr → Eth/Aztec keys   │   │
│  │ MLS Group Messaging        │  │ Single identity root     │   │
│  └────────────┬───────────────┘  └────────────┬─────────────┘   │
└───────────────┼─────────────────────────────────┼─────────────────┘
                │                                 │ derived keys
┌───────────────▼─────────────────────────────────▼─────────────────┐
│  LAYER 3: GOVERNANCE & SECURITY (EVM)                             │
│  ┌────────────────────────────┐  ┌──────────────────────────┐   │
│  │ pacto-gov (Nave Pirata)    │  │ delegated-security-    │   │
│  │ Hats + Safe Governance     │  │ manager                  │   │
│  │ Quartermaster, Mutiny,   │  │ Multi-layer security     │   │
│  │ Treasury, SquadAdmin       │  │ Role-based access        │   │
│  └────────────┬───────────────┘  └────────────┬─────────────┘   │
│               │ governance calls              │ secures         │
│  ┌────────────▼──────────────┐  ┌────────────▼─────────────┐   │
│  │ pacto-squad-sponsor     │  │                            │   │
│  │ Gas fee sponsorship     │  │                            │   │
│  └─────────────────────────┘  └────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────────┐
│  LAYER 4: PRIVACY (AZTEC)                                       │
│  ┌────────────────────────────┐                                 │
│  │ pacto-aztec                │                                 │
│  │ Noir ZK Contracts          │                                 │
│  │ Private voting & payments  │                                 │
│  │ Zero-knowledge proofs      │                                 │
│  └────────────────────────────┘                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  LAYER 5: INFRASTRUCTURE & FUNDING                              │
│  ┌────────────────────────────┐  ┌──────────────────────────┐   │
│  │ contributor-pool           │  │ .github                  │   │
│  │ (ARCHIVED) Staking pool    │  │ Org templates & norms    │   │
│  │ Autonomous payouts         │  │ Community guidelines     │   │
│  └────────────────────────────┘  └──────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## The "Why" — Plain English

### The Problem

Today, if you want to organize a group of people online, you have two bad choices:

**Choice A: Use a normal app** (Discord, WhatsApp, Signal)
- **Pros:** Easy to chat privately.
- **Cons:** The company running it can ban you, read your metadata (who talked to whom, when), or hand data over to governments. There is no built-in way to vote on spending group money or manage a shared treasury. If the app kicks you out, your community history and relationships vanish.

**Choice B: Use a blockchain DAO** (Snapshot, Aragon, etc.)
- **Pros:** No one can censor your votes or steal the treasury (rules are enforced by code).
- **Cons:** Every vote and transaction is **public** on a blockchain. Everyone can see who voted, how much money you have, and who sent what to whom. Also, setting up wallets and paying "gas fees" is a nightmare for normal people.

**Pacto wants both:** the privacy of Signal *and* the enforceable rules of a DAO, without the complexity.

### Why Two Different Networks?

Pacto splits the job between two specialized networks because **chat and money need different things**.

**1. Nostr (the chat layer)**
Think of Nostr as a global network of public bulletin boards (relays). Anyone can run a bulletin board. Your app posts encrypted messages to them, and your friends' apps read those messages off any board they want.
- **Why this matters:** If one bulletin board bans you, you just use another. There is no central company to shut down. It is "censorship-resistant."
- **Privacy:** They use modern encryption so only the intended recipient can read the message. They also wrap messages in extra layers so even the bulletin board operator cannot see who is talking to whom.
- **Why not blockchain for chat?** Putting every "lol" and "brb" on a blockchain would be absurdly expensive and slow. Nostr is basically free.

**2. Ethereum / Aztec (the money & rules layer)**
When you need to do things that *must* be enforced — like "only spend treasury money if 5 people vote yes" — you need a blockchain. This is where scarcity matters: there is only one vote, or one dollar, and the network makes sure no one cheats.
- **Ethereum (EVM):** The standard blockchain where they run the governance rules (who is in the group, who can spend, how to replace a leader).
- **Aztec:** A special privacy blockchain. Instead of everyone seeing "Alice voted YES and sent Bob $50," Aztec uses math tricks (zero-knowledge proofs) to prove the vote or payment is valid **without revealing who did it or how much it was**. Think of it as a sealed envelope that the blockchain can open just enough to verify it is real, then close again.

### Why the Pirate Ship Governance?

Pacto calls their governance system **"Nave Pirata"** (Pirate Ship). It is a metaphor for a small, tight-knit crew with clear rules.

**The Captain and the Crew**
- **Captain:** The leader. Can be a person, a group of people, or even another smart contract.
- **Crew:** The regular members.

**Two-Body Democracy**
Most groups fail because one person has all the power (dictatorship) or because nothing can get done without a 3-hour vote (paralysis). Pacto splits the power:
- **The crew** must vote to approve spending money or major decisions.
- **The captain** must also sign off.
- **Why both?** The crew cannot drain the treasury without the captain noticing. The captain cannot steal the treasury because the crew must approve withdrawals. It is a check-and-balance system.

**Mutiny**
If the captain goes rogue, disappears, or starts acting against the group, the crew can vote to replace them (51% vote). This is called "mutiny." It is a formal, on-chain process so there is no ambiguity or "he said, she said" about who is in charge.

**Why put roles on-chain?**
If your group rules live only inside a chat app, and that chat server goes down or bans you, you lose your entire organizational memory. By putting "who is the captain," "who is in the crew," and "what did we vote on" on a blockchain, that record is permanent and verifiable by anyone, even if you have to move to a new chat server tomorrow.

### Why One Key for Everything?

Normally, you have a login for Discord, a separate wallet for Ethereum, another for Bitcoin, etc. Pacto asks: **what if one key could unlock everything?**

You create one Nostr keypair (like a username/password, but cryptographic). From that single key, Pacto mathematically derives your Ethereum wallet address and your Aztec wallet address.
- **Why?** You do not need to manage multiple passwords, seed phrases, or browser extensions. One identity, many networks. This is how they achieve "embedded wallets that require no configuration."

### Why No KYC?

KYC = "Know Your Customer," the process where apps force you to upload a passport or driver's license. Pacto deliberately avoids this.
- **Why?** The target users are activists, labor unions, cooperatives, and dissidents in places where revealing your identity can get you arrested, fired, or harassed. By design, you can join a squad, vote, and manage money without ever proving your real-world name.

### The Big Picture Analogy

Imagine you and your friends want to start a pirate co-op to fund a community garden.

- **Chat:** You use Pacto to talk privately in your "Squad" (like a group chat). No company can read it. No government can subpoena a central server because there is not one.
- **Money:** You all chip in money to a shared safe (the **Safe Wallet**). The safe has a rule: two people must agree to open it.
- **Governance:** You elect a captain to manage day-to-day stuff, but the crew can vote to fire the captain if they mess up. All of this is recorded on a public ledger so there is no argument later about what was agreed.
- **Privacy:** When you vote on whether to buy a new shovel, you use the privacy layer so the local newspaper cannot see who voted or how much money is in the safe.
- **Gas:** The squad sponsor pays the network fees so your aunt who knows nothing about crypto can still vote without buying "ETH" first.

---

## Key Integration Points

1. **Nostr Identity Root:** All crypto keys derive from a single Nostr nsec.
2. **Vector Fork:** MLS group messaging comes from Vector (Rust backend).
3. **Hats Protocol:** Role-based authority across all governance.
4. **Safe Wallet:** Squad treasuries via the Zodiac module pattern.
5. **Two-Body Democracy:** Crew vote + Captain approval required for spending.
6. **ZK Privacy:** Aztec Noir for private votes and payments.
7. **Embedded Wallets:** Zero-config onboarding.
8. **No KYC:** Pseudonymous by design.
9. **NavePirataFactory:** Atomic one-shot squad deployment.
10. **Hats-Pointer Upgradeability:** Role upgrades via `transferHat`, not proxy migrations.

---

## Glossary of Terms

| Term | Meaning |
|------|---------|
| **Nostr** | A decentralized, censorship-resistant social protocol. Like Twitter but with no central server. |
| **NIP** | Nostr Improvement Proposal. A standard for how Nostr clients and relays behave. |
| **EVM** | Ethereum Virtual Machine. The runtime environment for Ethereum smart contracts. |
| **Aztec** | A privacy-focused blockchain that uses zero-knowledge proofs to hide transaction details. |
| **ZK / Zero-Knowledge** | A cryptographic method to prove something is true without revealing the underlying data. |
| **Noir** | A programming language for writing zero-knowledge circuits (used on Aztec). |
| **Hats Protocol** | An on-chain role management system. "Hats" are roles that can be worn, transferred, and revoked. |
| **Safe (Gnosis Safe)** | A multi-signature smart contract wallet. Requires multiple people to approve a transaction. |
| **Zodiac** | A modular framework for adding governance modules to Safe wallets. |
| **KYC** | "Know Your Customer." The process of verifying real-world identity (passport, ID, etc.). |
| **Gas** | The fee paid to process a transaction on a blockchain. |
| **MLS** | Messaging Layer Security. A modern standard for end-to-end encrypted group chats. |
| **E2EE** | End-to-End Encryption. Only the sender and recipient can read the message. |
| **DAO** | Decentralized Autonomous Organization. A group governed by code instead of traditional hierarchy. |
| **Mutiny** | In Pacto, the formal process where the crew votes to replace the captain. |
| **Two-Body Democracy** | Pacto's governance model where both the crew and the captain must approve actions. |
| **Treasury** | The shared pool of money controlled by a squad. |
| **Squad** | A private community hub inside Pacto (like a Discord server). |
| **Network** | A group of squads that can coordinate across organizational boundaries. |
| **Relay** | A server in the Nostr network that stores and forwards messages. |
| **nsec / npub** | Nostr secret key (private) and public key. Like a username/password pair but cryptographic. |
| **Tauri** | A framework for building desktop apps using web frontends and Rust backends. |
| **Foundry** | A toolkit for developing and testing Ethereum smart contracts. |
| **Bulloak** | A tool for generating Solidity tests from behavior trees. |
| **Halmos / Medusa** | Tools for formal verification and fuzz testing of smart contracts. |

---

*Document generated from research of github.com/covenant-gov and its subprojects.*
