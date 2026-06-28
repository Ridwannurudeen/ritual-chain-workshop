"use client";

import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { useNow } from "@/hooks/useNow";
import aiJudgeAbi from "@/abi/AIJudge";
import { contractAddress } from "@/config/contract";
import { ritualChain } from "@/config/wagmi";
import { canCommit, type Bounty } from "@/lib/bounty";
import {
  computeCommitment,
  randomSalt,
  saveCommitment,
  loadCommitment,
  ZERO_BYTES32,
} from "@/lib/commitment";
import { useWriteTx } from "@/hooks/useWriteTx";
import {
  Card,
  CardHeader,
  CardBody,
  Field,
  Textarea,
  Button,
  TxStatus,
  Notice,
} from "@/components/ui";

const explorerBase = ritualChain.blockExplorers?.default.url;

export function CommitAnswer({
  bountyId,
  bounty,
  onCommitted,
}: {
  bountyId: bigint;
  bounty: Bounty;
  onCommitted: () => void;
}) {
  const { address, isConnected } = useAccount();
  const [answer, setAnswer] = useState("");
  const now = useNow();
  const tx = useWriteTx(() => {
    onCommitted();
  });

  // Has this account already committed on-chain? (non-zero hash, not yet revealed)
  const { data: existing, refetch } = useReadContract({
    address: contractAddress,
    abi: aiJudgeAbi,
    functionName: "commitmentOf",
    args: address ? [bountyId, address] : undefined,
    chainId: ritualChain.id,
    query: { enabled: !!contractAddress && !!address },
  });

  // Commit window closed — nothing to show.
  if (!canCommit(bounty, now / 1000)) return null;

  const alreadyCommitted = !!existing && existing !== ZERO_BYTES32;
  const saved = address ? loadCommitment(bountyId, address) : null;

  async function handleCommit(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim() || !contractAddress || !address) return;

    const salt = randomSalt();
    const trimmed = answer.trim();
    const commitment = computeCommitment(trimmed, salt, address, bountyId);

    try {
      await tx.run({
        address: contractAddress,
        abi: aiJudgeAbi,
        functionName: "submitCommitment",
        args: [bountyId, commitment],
        chainId: ritualChain.id,
      });
      // Persist locally so the reveal step can replay (answer, salt).
      saveCommitment(bountyId, address, { answer: trimmed, salt, commitment });
      setAnswer("");
      void refetch();
    } catch {
      /* surfaced via tx.state */
    }
  }

  return (
    <Card>
      <CardHeader
        title="Commit an answer"
        subtitle="Only a hash is stored now. Your answer stays private until you reveal after the deadline."
      />
      <CardBody>
        {alreadyCommitted ? (
          <Notice tone="green">
            You&apos;ve committed to this bounty.{" "}
            {saved
              ? "Your answer and salt are saved in this browser — come back after the deadline to reveal."
              : "Keep your answer and salt safe; you'll need them to reveal after the deadline."}{" "}
            Committing again overwrites your previous entry.
          </Notice>
        ) : null}

        <form onSubmit={handleCommit} className="mt-3 space-y-3">
          <Field
            label="Your answer"
            hint="Stored only as a hash on-chain. Saved locally so you can reveal later."
          >
            <Textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={5}
              placeholder="Write your submission…"
            />
          </Field>
          <Button
            type="submit"
            disabled={!isConnected || !answer.trim() || tx.isBusy}
            className="w-full"
          >
            {tx.isBusy
              ? "Committing…"
              : alreadyCommitted
                ? "Re-commit (overwrite)"
                : "Commit answer"}
          </Button>
          {!isConnected && (
            <p className="text-xs text-zinc-500">
              Connect your wallet to commit.
            </p>
          )}
          <TxStatus
            state={tx.state}
            error={tx.error}
            hash={tx.hash}
            explorerBase={explorerBase}
          />
        </form>
      </CardBody>
    </Card>
  );
}
