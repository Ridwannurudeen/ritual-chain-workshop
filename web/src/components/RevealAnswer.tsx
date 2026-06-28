"use client";

import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { useNow } from "@/hooks/useNow";
import aiJudgeAbi from "@/abi/AIJudge";
import { contractAddress } from "@/config/contract";
import { ritualChain } from "@/config/wagmi";
import { canReveal, type Bounty } from "@/lib/bounty";
import {
  clearCommitment,
  loadCommitment,
  ZERO_BYTES32,
} from "@/lib/commitment";
import { useWriteTx } from "@/hooks/useWriteTx";
import {
  Card,
  CardHeader,
  CardBody,
  Field,
  Input,
  Textarea,
  Button,
  TxStatus,
  Notice,
} from "@/components/ui";

const explorerBase = ritualChain.blockExplorers?.default.url;

export function RevealAnswer({
  bountyId,
  bounty,
  onRevealed,
}: {
  bountyId: bigint;
  bounty: Bounty;
  onRevealed: () => void;
}) {
  const { address, isConnected } = useAccount();
  const now = useNow();

  const saved = address ? loadCommitment(bountyId, address) : null;
  const [answer, setAnswer] = useState(saved?.answer ?? "");
  const [salt, setSalt] = useState<string>(saved?.salt ?? "");

  const tx = useWriteTx(() => {
    if (address) clearCommitment(bountyId, address);
    onRevealed();
  });

  const { data: existing, refetch } = useReadContract({
    address: contractAddress,
    abi: aiJudgeAbi,
    functionName: "commitmentOf",
    args: address ? [bountyId, address] : undefined,
    chainId: ritualChain.id,
    query: { enabled: !!contractAddress && !!address },
  });

  // Only relevant during the reveal window.
  if (!canReveal(bounty, now / 1000)) return null;

  const hasCommitment = !!existing && existing !== ZERO_BYTES32;
  const saltValid = /^0x[0-9a-fA-F]{64}$/.test(salt.trim());
  const canSubmit = hasCommitment && !!answer.trim() && saltValid;

  async function handleReveal(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !contractAddress) return;
    try {
      await tx.run({
        address: contractAddress,
        abi: aiJudgeAbi,
        functionName: "revealAnswer",
        args: [bountyId, answer.trim(), salt.trim() as `0x${string}`],
        chainId: ritualChain.id,
      });
      void refetch();
    } catch {
      /* surfaced via tx.state */
    }
  }

  return (
    <Card>
      <CardHeader
        title="Reveal your answer"
        subtitle="Submission closed. Reveal before the reveal deadline to be judged."
      />
      <CardBody>
        {isConnected && !hasCommitment ? (
          <Notice tone="zinc">
            No commitment to reveal for this account — you either didn&apos;t
            commit before the deadline, or you&apos;ve already revealed.
          </Notice>
        ) : (
          <form onSubmit={handleReveal} className="space-y-3">
            {!saved && (
              <Notice tone="amber">
                No saved entry found in this browser. Paste the exact answer and
                salt you committed with.
              </Notice>
            )}
            <Field label="Your answer">
              <Textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={5}
                placeholder="The exact answer you committed…"
              />
            </Field>
            <Field
              label="Salt"
              hint="The 0x… value generated when you committed."
            >
              <Input
                value={salt}
                onChange={(e) => setSalt(e.target.value)}
                placeholder="0x…"
              />
            </Field>
            {salt.trim() !== "" && !saltValid && (
              <p className="text-xs text-amber-300">
                Salt must be a 0x-prefixed 32-byte hex value.
              </p>
            )}
            <Button
              type="submit"
              disabled={!isConnected || !canSubmit || tx.isBusy}
              className="w-full"
            >
              {tx.isBusy ? "Revealing…" : "Reveal answer"}
            </Button>
            {!isConnected && (
              <p className="text-xs text-zinc-500">
                Connect your wallet to reveal.
              </p>
            )}
            <TxStatus
              state={tx.state}
              error={tx.error}
              hash={tx.hash}
              explorerBase={explorerBase}
            />
          </form>
        )}
      </CardBody>
    </Card>
  );
}
