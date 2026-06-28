# Architecture Note

Two designs are described here:

- **Required track (implemented)** — commit–reveal. Answers are hidden by storing only a
  hash until the submission window closes.
- **Advanced track (design)** — Ritual-native. Answers stay *encrypted* on-chain and are
  only ever decrypted inside the TEE at the moment of batch judging.

---

## Required track: commit–reveal (implemented)

### Where plaintext answers exist

| Stage | Plaintext answer lives… |
| --- | --- |
| Commit | **Off-chain only** — in the participant's browser (`localStorage`) alongside the salt. On-chain there is only `keccak256(abi.encode(answer, salt, sender, bountyId))`. |
| Reveal | **On-chain, public** — `revealAnswer` writes the answer into `Bounty.submissions[]`. By now the commit window is closed, so publishing it can no longer help a copier. |
| Judge | Read from on-chain storage, assembled into one LLM prompt. |

### On-chain vs off-chain

- **On-chain (commit phase):** `commitmentOf[bountyId][sender]` (a `bytes32` hash),
  `commitmentCount`, bounty metadata, locked reward.
- **On-chain (after reveal):** the plaintext `Submission { submitter, answer }` array, and
  after judging the `aiReview` bytes returned by the model.
- **Off-chain:** the `(answer, salt)` pair before reveal (browser storage), and the
  construction of `llmInput` (prompt assembly happens in the client, see
  `web/src/lib/ritualLlm.ts`).

### How the LLM receives submissions for batch judging

`judgeAll` performs **one** inference for the whole bounty, not one call per answer:

1. After `revealDeadline`, the owner's client reads every revealed submission via
   `getSubmission`.
2. The client serializes them into a single JSON array and embeds it in a system+user
   message prompt that instructs the model to rank all entries against the rubric and
   return strict JSON (`{ winnerIndex, summary }`), explicitly treating submissions as
   untrusted content (prompt-injection guard).
3. That payload is ABI-encoded into `llmInput` and passed to `judgeAll`, which forwards it
   to the Ritual LLM precompile (`0x0802`). The block builder runs the model inside a TEE
   executor and replays the transaction with the signed result.
4. The decoded completion is stored on-chain as `aiReview`; the UI parses it to show a
   ranking and the recommended winner.

### Trust boundary

The commit–reveal design keeps answers secret **from other participants**, which is the
flaw it targets. It does **not** hide answers from the world after reveal — they are
public on-chain before judging. That is acceptable for "stop copying during submission,"
but not for "answers must never be public." The Advanced design closes that gap.

---

## Advanced track: Ritual-native hidden submissions (design)

Goal: encrypted answers remain hidden **until the AI judging step completes** — no public
reveal phase at all. This uses Ritual's encrypted-inputs / DKMS facilities and the
TEE-backed LLM precompile.

### Where plaintext answers exist

| Stage | Plaintext answer lives… |
| --- | --- |
| Submit | **Off-chain, transiently** — in the participant's browser while encrypting. |
| In flight / at rest | **Nowhere in plaintext.** Only ciphertext is stored on-chain. |
| Judge | **Only inside the TEE**, for the duration of one inference. The enclave decrypts, ranks, and emits only the verdict. |
| After judge | Plaintext never re-materializes on-chain. Optionally the winner alone is revealed. |

### On-chain vs off-chain

- **On-chain:** for each entry, the ciphertext of the answer (or a content hash + pointer
  to an off-chain blob), plus the encrypted data-encryption key / secret references that
  authorize the TEE to decrypt. Bounty metadata and the locked reward as before. After
  judging: the `aiReview` verdict bytes.
- **Off-chain:** large answer blobs may live in a content-addressed store (the on-chain
  record holds the hash + URI); the plaintext exists only in the submitter's browser at
  encryption time and inside the enclave at judging time.

### Encryption model

- Each answer is encrypted to a **bounty public key** whose private half is held by
  Ritual's key-management precompile (DKMS, `0x081B`) and is releasable **only** to the
  attested TEE executor that runs the judging job — and only after `revealDeadline`.
  Concretely: a per-submission symmetric key encrypts the answer; that symmetric key is
  wrapped to the bounty key and stored as an encrypted secret. This is the
  "encrypted secrets / private inputs" path the LLM request already has fields for
  (`encryptedSecrets`, `secretSignatures`, `userPublicKey` in `ritualLlm.ts`).
- Because decryption is gated on attestation + time, no participant, the bounty owner, or
  a chain observer can read any answer before judging.

### How the LLM receives submissions for batch judging

1. `submitEncrypted(bountyId, ciphertext, wrappedKey)` stores the encrypted entry. No
   reveal transaction is ever required from participants.
2. After `revealDeadline`, the owner calls `judgeAll(bountyId, llmInput)` where `llmInput`
   references **all** the encrypted entries and their wrapped keys.
3. The TEE executor: verifies the time gate, unwraps each key via the DKMS precompile,
   decrypts every answer **inside the enclave**, concatenates them into one batched prompt
   (the same single-inference shape as the required track), runs the model once, and
   signs the ranking.
4. Only the verdict (`{ winnerIndex, summary }`) is returned and stored on-chain. The
   plaintext answers and keys never leave the enclave.

### Trade-offs vs commit–reveal

| | Commit–reveal (implemented) | Ritual TEE (design) |
| --- | --- | --- |
| Answers public before judging | Yes, after reveal | Never |
| Participant UX | Two transactions (commit + reveal); must keep salt | One transaction; nothing to keep |
| Liveness risk | A participant who never reveals is simply dropped | No reveal step to miss |
| Trust assumption | Cryptographic hash only | TEE attestation + DKMS key custody |
| Portability | Any EVM chain | Ritual-specific precompiles |

The implemented commit–reveal contract is the EVM-portable baseline; the TEE design is the
stronger, Ritual-native upgrade when answers must remain confidential even after the
bounty closes.
