import type { Address } from "viem";

/** Parsed shape of the `getBounty` tuple return value. */
export type Bounty = {
  owner: Address;
  title: string;
  rubric: string;
  reward: bigint;
  deadline: bigint;
  revealDeadline: bigint;
  judged: boolean;
  finalized: boolean;
  submissionCount: bigint;
  commitmentCount: bigint;
  winnerIndex: bigint;
  aiReview: `0x${string}`;
};

/** getBounty returns a positional tuple — map it to a named object. */
export function parseBounty(
  raw: readonly [
    Address,
    string,
    string,
    bigint,
    bigint,
    bigint,
    boolean,
    boolean,
    bigint,
    bigint,
    bigint,
    `0x${string}`,
  ],
): Bounty {
  const [
    owner,
    title,
    rubric,
    reward,
    deadline,
    revealDeadline,
    judged,
    finalized,
    submissionCount,
    commitmentCount,
    winnerIndex,
    aiReview,
  ] = raw;
  return {
    owner,
    title,
    rubric,
    reward,
    deadline,
    revealDeadline,
    judged,
    finalized,
    submissionCount,
    commitmentCount,
    winnerIndex,
    aiReview,
  };
}

/**
 * Lifecycle phases:
 * - commit:    before the submission deadline — only hashes are accepted.
 * - reveal:    deadline passed, reveal window open — plaintext + salt accepted.
 * - ready:     reveal window closed — owner can run AI judging.
 * - judged:    AI review stored, owner can finalize.
 * - finalized: reward paid out.
 */
export type BountyStatus =
  | "commit"
  | "reveal"
  | "ready"
  | "judged"
  | "finalized";

// Ritual Chain reports block.timestamp in milliseconds, so on-chain deadlines
// are milliseconds too — compare them against Date.now() (also milliseconds).
export function getBountyStatus(b: Bounty, nowMs = Date.now()): BountyStatus {
  if (b.finalized) return "finalized";
  if (b.judged) return "judged";
  if (Number(b.revealDeadline) <= nowMs) return "ready";
  if (Number(b.deadline) <= nowMs) return "reveal";
  return "commit";
}

export const STATUS_META: Record<
  BountyStatus,
  { label: string; tone: "green" | "amber" | "indigo" | "zinc" }
> = {
  commit: { label: "Commit phase", tone: "green" },
  reveal: { label: "Reveal phase", tone: "amber" },
  ready: { label: "Ready for judging", tone: "indigo" },
  judged: { label: "Judged", tone: "indigo" },
  finalized: { label: "Finalized", tone: "zinc" },
};

/** Can a participant still commit a hashed answer? */
export function canCommit(b: Bounty, nowMs = Date.now()): boolean {
  return !b.judged && !b.finalized && Number(b.deadline) > nowMs;
}

/** Is the reveal window currently open? */
export function canReveal(b: Bounty, nowMs = Date.now()): boolean {
  return (
    !b.judged &&
    !b.finalized &&
    Number(b.deadline) <= nowMs &&
    Number(b.revealDeadline) > nowMs
  );
}
