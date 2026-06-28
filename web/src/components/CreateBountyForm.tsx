"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { parseEther, parseEventLogs } from "viem";
import { contractAddress, isContractConfigured } from "@/config/contract";
import { ritualChain } from "@/config/wagmi";
import aiJudgeAbi from "@/abi/AIJudge";
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

/** Default datetime-local value = now + 1 hour, in the input's expected format. */
function localDateTime(msFromNow: number): string {
  const d = new Date(Date.now() + msFromNow);
  // Strip seconds/tz to YYYY-MM-DDTHH:mm in local time.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

const HOUR_MS = 60 * 60 * 1000;

export function CreateBountyForm({
  onCreated,
}: {
  onCreated?: (bountyId: bigint) => void;
}) {
  const { isConnected } = useAccount();
  const [title, setTitle] = useState("");
  const [rubric, setRubric] = useState("");
  const [deadline, setDeadline] = useState(localDateTime(HOUR_MS));
  const [revealDeadline, setRevealDeadline] = useState(
    localDateTime(2 * HOUR_MS),
  );
  const [reward, setReward] = useState("");
  const [createdId, setCreatedId] = useState<bigint | null>(null);

  // Once confirmed, pull the new bountyId out of the BountyCreated event log.
  const tx = useWriteTx((receipt) => {
    try {
      const logs = parseEventLogs({
        abi: aiJudgeAbi,
        eventName: "BountyCreated",
        logs: receipt.logs,
      });
      const id = logs[0]?.args?.bountyId;
      if (id !== undefined) {
        setCreatedId(id);
        onCreated?.(id);
      }
    } catch {
      /* couldn't decode — not fatal */
    }
  });

  // Pure, render-safe validation (no clock reads here — see handleSubmit).
  const validation = useMemo(() => {
    if (!title.trim()) return "Title is required.";
    if (!rubric.trim()) return "Rubric is required.";
    if (!deadline) return "Pick a deadline.";
    const ts = new Date(deadline).getTime();
    if (!Number.isFinite(ts)) return "Invalid deadline.";
    if (!revealDeadline) return "Pick a reveal deadline.";
    const revealTs = new Date(revealDeadline).getTime();
    if (!Number.isFinite(revealTs)) return "Invalid reveal deadline.";
    if (revealTs <= ts) return "Reveal deadline must be after the deadline.";
    if (reward !== "") {
      try {
        parseEther(reward);
      } catch {
        return "Reward must be a valid number.";
      }
    }
    return null;
  }, [title, rubric, deadline, revealDeadline, reward]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (validation || !contractAddress) return;

    const deadlineMs = new Date(deadline).getTime();
    const revealMs = new Date(revealDeadline).getTime();
    if (deadlineMs <= Date.now()) {
      // Clock read belongs in the event handler, not render.
      window.alert("Deadline must be in the future.");
      return;
    }
    if (revealMs <= deadlineMs) {
      window.alert("Reveal deadline must be after the deadline.");
      return;
    }

    const deadlineTs = BigInt(Math.floor(deadlineMs / 1000));
    const revealDeadlineTs = BigInt(Math.floor(revealMs / 1000));
    const value = reward.trim() === "" ? 0n : parseEther(reward.trim());
    setCreatedId(null);

    try {
      await tx.run({
        address: contractAddress,
        abi: aiJudgeAbi,
        functionName: "createBounty",
        args: [title.trim(), rubric.trim(), deadlineTs, revealDeadlineTs],
        value,
        chainId: ritualChain.id,
      });
    } catch {
      /* surfaced via tx.state */
    }
  }

  return (
    <Card>
      <CardHeader
        title="Create a bounty"
        subtitle="Fund a reward and define how submissions will be judged."
      />
      <CardBody>
        {!isContractConfigured && (
          <Notice tone="amber">
            Set <code className="font-mono">NEXT_PUBLIC_CONTRACT_ADDRESS</code>{" "}
            in your <code className="font-mono">.env.local</code> to enable
            transactions.
          </Notice>
        )}

        <form onSubmit={handleSubmit} className="mt-3 space-y-3">
          <Field label="Title">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Best gas-optimization writeup"
              maxLength={200}
            />
          </Field>

          <Field
            label="Rubric"
            hint="How submissions are scored. The AI judges only against this."
          >
            <Textarea
              value={rubric}
              onChange={(e) => setRubric(e.target.value)}
              rows={4}
              placeholder="Correctness 50%, clarity 30%, novelty 20%…"
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="Deadline"
              hint="Commit phase ends; reveal phase begins."
            >
              <Input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </Field>
            <Field
              label="Reveal deadline"
              hint="Reveal phase ends; judging can begin."
            >
              <Input
                type="datetime-local"
                value={revealDeadline}
                onChange={(e) => setRevealDeadline(e.target.value)}
              />
            </Field>
            <Field
              label="Reward (RITUAL)"
              hint="Locked in the contract on create."
            >
              <Input
                type="number"
                min="0"
                step="any"
                value={reward}
                onChange={(e) => setReward(e.target.value)}
                placeholder="1.0"
              />
            </Field>
          </div>

          {validation && (title || rubric || reward) ? (
            <p className="text-xs text-amber-300">{validation}</p>
          ) : null}

          <Button
            type="submit"
            disabled={
              !isConnected || !isContractConfigured || !!validation || tx.isBusy
            }
            className="w-full"
          >
            {tx.isBusy ? "Creating…" : "Create bounty"}
          </Button>

          {!isConnected && (
            <p className="text-xs text-zinc-500">
              Connect your wallet to create a bounty.
            </p>
          )}

          <TxStatus
            state={tx.state}
            error={tx.error}
            hash={tx.hash}
            explorerBase={explorerBase}
          />

          {createdId !== null && (
            <Notice tone="green">
              Bounty created with id{" "}
              <span className="font-mono font-semibold">
                #{createdId.toString()}
              </span>
              . Loaded below.
            </Notice>
          )}
        </form>
      </CardBody>
    </Card>
  );
}
