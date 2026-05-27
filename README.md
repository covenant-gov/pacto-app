# Pacto

Pacto is a private, censorship-resistant, and governable community organizing platform that requires no KYC. Encrypted communications run over Nostr, a decentralized client-relay network, while governance and financial operations execute over EVM or Aztec blockchains with embedded wallets that require no configuration. Everything just works.

[Nostr](https://nostr.com/) is used for communications because it is computationally cheap (virtually free to use), decentralized (censorship-resistant), and enables privacy with the following standards: [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md) Private DMs, [NIP-44 ](https://github.com/nostr-protocol/nips/blob/master/44.md) Encrypted Payloads, [NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md) Gift Wraps (metadata protection).

[Ethereum](https://ethereum.org/) and [Aztec](https://docs.aztec.network/) networks handle governance and financial activities - domains requiring enforcement of scarcity (votes and coins are digitally scarce items), unlike communications that only require privacy.

Privacy on these blockchains is achieved through Zero-Knowledge (ZK) proving schemes, which verify computation without exposing sensitive data. This enables voting and payments with Ethereum's security and immutability guarantees while keeping user activity private.

## Feature Set

Core
- DMs: End-to-End-Encrypted (E2EE) direct messaging
- Squads: private Discord/Slack-style community hubs with text channels
- Networks: private community hubs comprised of Squads that allow inter-organizational coordination (Squad of Squads)

Squad / Network
- Message Layer Security (MLS) private and metadata-protected group messaging channels
- Dashboard with Web3-integrated widgets
- Modular Governance Platform to accommodate various models of democracy and decision making
- Safe Wallet for collective management of financial resources

## Architecture Diagram

[WIP]

## Fork

[Vector](https://vectorapp.io/) - Private decentralized messenger built on Nostr

Pacto forked the Rust [backend of Vector](https://github.com/VectorPrivacy/Vector/tree/master/src-tauri) for the Nostr E2EE/MLS messaging. While Vector offers a Signal-style privacy messenger with mini-app support, Pacto extends the codebase to enable Discord-inspired communities that are governable through embedded blockchain primitives.

## Developer documentation

- **Embedded wallet (RPC, DM message schema, pricing, tx lifecycle):** [docs/wallet/README.md](./docs/wallet/README.md)
- **Governance contracts (pacto-gov):** [docs/wallet/PACTO_GOV.md](./docs/wallet/PACTO_GOV.md) — upstream [covenant-gov/pacto-gov](https://github.com/covenant-gov/pacto-gov); Alloy bindings in `src-tauri/src/evm/contracts/`.

## Build Prerequisites

- [Ubuntu](./docs/build/ubuntuGuide.md)
- [macOS](./docs/build/macGuide.md)
- [Windows](./docs/build/windowsGuide.md)
