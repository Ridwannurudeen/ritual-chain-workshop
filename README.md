# Commit–Reveal AI Bounty Judge

> **Live on Ritual testnet (chain 1979):** `AIJudge` at
> `0x65AC3E1301E67d2B48B8F4b418BcfbBe359bd02D`

A privacy-preserving bounty system on Ritual Chain. Participants compete to answer a
bounty; an AI judge ranks every entry against the rubric; the owner finalizes a winner
and the contract pays out.

This repo fixes a concrete flaw in the original workshop starter: **submissions were
public**. The old `submitAnswer(bountyId, answer)` wrote the plaintext answer straight
into contract storage, and `getSubmission` is a public view — so anyone could read every
entry and submit an improved copy before the deadline. The deadline check was even
commented out.

The fix is a **commit–reveal** flow: during the submission window only a hash is stored,
so there is nothing to copy. Answers become public only after the window closes, when
they can no longer influence anyone else's entry.

```
/hardhat   Solidity contract (AIJudge.sol), tests, deployment
/web       Next.js frontend (commit → reveal → judge → finalize)
/docs      Architecture note, test plan, reflection
```

## Lifecycle

```
 create ──▶ COMMIT ──(deadline)──▶ REVEAL ──(revealDeadline)──▶ JUDGE ──▶ FINALIZE
            hash only              plaintext + salt             AI ranks    owner pays
```

1. **Create** — `createBounty(title, rubric, deadline, revealDeadline)` (payable). The
   reward is locked in the contract. `deadline` ends the commit phase; `revealDeadline`
   ends the reveal phase. The contract requires `revealDeadline > deadline > now`.
2. **Commit** (`now < deadline`) — `submitCommitment(bountyId, commitment)`. Only the
   hash is stored. One commitment per participant per bounty (a second
   `submitCommitment` reverts). Capped at `MAX_SUBMISSIONS` (10) distinct addresses.
3. **Reveal** (`deadline ≤ now < revealDeadline`) — `revealAnswer(bountyId, answer, salt)`.
   The contract recomputes the commitment and stores the plaintext only if it matches.
   Each commitment can be revealed once.
4. **Judge** (`now ≥ revealDeadline`, owner only) — `judgeAll(bountyId, llmInput)`. The
   revealed answers are sent to the Ritual LLM precompile in a **single** batched
   inference call; the model returns a ranking and a recommended winner.
5. **Finalize** (owner only) — `finalizeWinner(bountyId, winnerIndex)` pays the reward to
   the chosen submission. The AI recommendation is advisory; the human decides.

## The commitment scheme

```
commitment = keccak256(abi.encodePacked(answer, salt, msg.sender, bountyId))
```

Three properties make this safe:

- **Hidden** — during the commit phase only this hash is on-chain. The answer cannot be
  derived from it.
- **Sender-bound** — the hash includes `msg.sender`, so a commitment copied from the
  mempool is worthless to anyone else; they cannot produce a matching reveal.
- **Copy-proof** — reveals happen only *after* the commit phase closes, so seeing a
  revealed answer is useless: you can no longer commit.

`salt` is 32 random bytes the participant must keep. The frontend generates it, stores
`(answer, salt)` in `localStorage`, and replays it at reveal time; if storage is lost the
participant can paste both by hand. The matching client encoding is
`keccak256(encodePacked(["string", "bytes32", "address", "uint256"], [answer, salt, account, bountyId]))`
(see `web/src/lib/commitment.ts`).

## Functions

| Function | Phase | Who |
| --- | --- | --- |
| `createBounty(title, rubric, deadline, revealDeadline)` payable | — | anyone |
| `submitCommitment(bountyId, commitment)` | commit | participant |
| `revealAnswer(bountyId, answer, salt)` | reveal | participant |
| `judgeAll(bountyId, llmInput)` | after reveal | owner |
| `finalizeWinner(bountyId, winnerIndex)` | after judged | owner |
| `getBounty`, `getSubmission`, `commitmentOf` (views) | any | anyone |

## Build, test, deploy

```bash
# Contract
cd hardhat
pnpm install
pnpm hardhat test solidity        # 17 commit-reveal tests
pnpm hardhat ignition deploy --network ritual ignition/modules/AIJudge.ts

# Frontend
cd web
pnpm install --ignore-workspace
cp .env.example .env.local         # set NEXT_PUBLIC_CONTRACT_ADDRESS
pnpm dev
```

The contract compiles with `viaIR: true` (enabled in both Solidity profiles in
`hardhat.config.ts`) because `getBounty` returns 12 values and exceeds the stack limit
without the IR pipeline.

> `judgeAll` calls the Ritual LLM precompile (`0x0802`), which only exists on Ritual
> Chain. Local Solidity tests exercise it through a mocked precompile (`vm.mockCall`); the
> live inference path is verified on Ritual testnet. See `docs/TEST_PLAN.md`.

## Running on Ritual Chain — quirks the frontend handles

Ritual Chain differs from a stock EVM in three ways that affect the dapp (all handled in `web/`):

- **EIP-1559 only.** Ritual rejects legacy (type-0) transactions. The frontend forces type-2
  by handing the wallet explicit fees (`useWriteTx`). Wallets that always send legacy for
  custom networks (e.g. Rabby on an unrecognised chain) won't work — use a wallet that sends
  type-2, such as MetaMask.
- **`block.timestamp` is in milliseconds**, not seconds. All deadlines are sent and compared
  in milliseconds (`CreateBountyForm`, `lib/bounty.ts`, `lib/format.ts`).
- **LLM judging is metered.** `judgeAll` spends from the caller's prepaid, locked
  `RitualWallet`; a single batch judging call costs ~0.3 RITUAL on testnet, so the deposit
  defaults are sized with headroom (`lib/ritualWallet.ts`).

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — data-flow, what's on-chain vs off-chain,
  and the Advanced (Ritual TEE) design for encrypted-until-judging submissions.
- [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md) — reveal-case test plan.
- [`docs/REFLECTION.md`](docs/REFLECTION.md) — public vs hidden vs AI vs human.
