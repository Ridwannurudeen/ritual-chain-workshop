# Test Plan — Commit/Reveal Cases

Automated suite: `hardhat/contracts/AIJudge.t.sol` (forge-std). Run with:

```bash
cd hardhat && pnpm hardhat test solidity
```

All 17 tests pass. The `judgeAll` success path is exercised by stubbing the Ritual LLM
precompile with `vm.mockCall` (it has no code off Ritual Chain).

## Reveal cases

| # | Scenario | Expectation | Test |
| --- | --- | --- | --- |
| 1 | Commit then reveal the matching answer | Plaintext stored; no submission visible before reveal | `test_CommitThenRevealStoresAnswer` |
| 2 | Reveal with the wrong salt | revert `commitment mismatch` | `test_RevealWrongSaltReverts` |
| 3 | Reveal with a tampered answer | revert `commitment mismatch` | `test_RevealWrongAnswerReverts` |
| 4 | A different address tries to reveal someone's (answer, salt) | revert `nothing to reveal` (hash is sender-bound) | `test_OtherSenderCannotRevealSomeoneElsesAnswer` |
| 5 | Reveal before the deadline (commit phase) | revert `reveal not open` | `test_RevealBeforeDeadlineReverts` |
| 6 | Reveal after the reveal deadline | revert `reveal phase over` | `test_RevealAfterRevealDeadlineReverts` |
| 7 | Reveal the same commitment twice | second reverts `nothing to reveal` | `test_DoubleRevealReverts` |
| 8 | Reveal an answer longer than `MAX_ANSWER_LENGTH` | revert `answer too long` | `test_RevealTooLongAnswerReverts` |
| 9 | Re-commit before deadline, then reveal | only the latest (answer, salt) reveals; slot not double-counted | `test_RecommitOverwritesAndOnlyLatestReveals` |

## Commit cases

| # | Scenario | Expectation | Test |
| --- | --- | --- | --- |
| 10 | Commit after the deadline | revert `commit phase over` | `test_CommitAfterDeadlineReverts` |
| 11 | Commit a zero hash | revert `empty commitment` | `test_EmptyCommitmentReverts` |
| 12 | An 11th distinct committer | revert `too many submissions` (cap = 10) | `test_CommitmentCapEnforced` |

## Judge / finalize gating

| # | Scenario | Expectation | Test |
| --- | --- | --- | --- |
| 13 | `judgeAll` before the reveal deadline | revert `reveal phase not over` | `test_JudgeBeforeRevealDeadlineReverts` |
| 14 | `judgeAll` with zero revealed submissions | revert `no submissions` | `test_JudgeWithNoSubmissionsReverts` |
| 15 | `judgeAll` from a non-owner | revert `not bounty owner` | `test_JudgeNotOwnerReverts` |
| 16 | Full path: two commit+reveal, judge (mocked), finalize | winner is paid the reward; `judged`/`finalized` set | `test_JudgeAndFinalizePaysWinner` |
| 17 | `finalizeWinner` before judging | revert `not judged yet` | `test_FinalizeBeforeJudgeReverts` |

## Manual / testnet integration (not in the automated suite)

The LLM precompile cannot run on the local simulated EVM, so the following are checked on
Ritual testnet against a deployed contract:

- `judgeAll` with a real funded RitualWallet returns a parseable `{ winnerIndex, summary }`
  and stores it as `aiReview`.
- The judge prompt rejects prompt-injection inside a submission (a submission instructing
  the model to pick it does not change the ranking).
- End-to-end through the frontend: create → commit (hash only on-chain) → reveal after
  deadline → judge after reveal deadline → finalize pays the winner.
- Salt-loss recovery: clear `localStorage`, then reveal by pasting the answer and salt.
