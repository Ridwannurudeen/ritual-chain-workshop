# Reflection

**What should be public, what should stay hidden, and what should be decided by AI versus by a human in a bounty system?**

The bounty's *rules* should be fully public: the rubric, the reward, the deadlines, the
list of who participated, and — after judging — the verdict and the reasoning behind it,
since transparency is what makes the outcome trustworthy and contestable. What must stay
hidden is each participant's actual answer *during the submission window*, because once one
entry is visible others can copy and marginally improve it, which destroys the incentive to
do original work; the commit–reveal flow enforces exactly this by storing only a hash until
the window closes, and the Ritual TEE design extends it so answers can stay encrypted even
afterward. Salts and any private keys are permanently secret and never belong on-chain. The
AI is well-suited to the *labor* of judging — reading every submission, scoring it against
the rubric consistently, and ranking at a scale and speed humans can't match — and doing it
in one batched, auditable inference rather than ad-hoc human review. But the AI's output
should be treated as a recommendation, not a verdict, because models can be wrong, gamed by
prompt injection inside submissions, or miss context the rubric didn't capture. The final,
fund-moving decision should stay with a human (the bounty owner), who can override the AI
and is accountable for the payout — which is why `finalizeWinner` is a separate,
owner-only step. In short: make the process and the reasoning public, keep the answers
private until they can't be copied, let AI do the scoring at scale, and keep the human in
the loop for the decision that actually spends money.
