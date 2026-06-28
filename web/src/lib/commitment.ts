import { keccak256, encodePacked, toHex, zeroHash, type Address } from "viem";

/**
 * Commit-reveal helpers.
 *
 * The on-chain commitment is `keccak256(abi.encodePacked(answer, salt, sender, bountyId))`
 * — the exact scheme `AIJudge.revealAnswer` re-derives and checks. Binding the
 * hash to the sender and bounty means a commitment copied from the mempool is
 * useless to anyone else.
 *
 * The (answer, salt) pair is the only way to reveal later, so we stash it in
 * localStorage keyed by bounty + account. If the user clears storage or switches
 * devices they must re-enter their answer and salt by hand on the reveal step.
 */

export type StoredCommitment = {
  answer: string;
  salt: `0x${string}`;
  commitment: `0x${string}`;
};

export function computeCommitment(
  answer: string,
  salt: `0x${string}`,
  account: Address,
  bountyId: bigint,
): `0x${string}` {
  return keccak256(
    encodePacked(
      ["string", "bytes32", "address", "uint256"],
      [answer, salt, account, bountyId],
    ),
  );
}

/** 32 cryptographically-random bytes as a 0x-prefixed bytes32. */
export function randomSalt(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

function storageKey(bountyId: bigint, account: Address): string {
  return `aibj:commit:${bountyId.toString()}:${account.toLowerCase()}`;
}

export function saveCommitment(
  bountyId: bigint,
  account: Address,
  record: StoredCommitment,
): void {
  try {
    localStorage.setItem(storageKey(bountyId, account), JSON.stringify(record));
  } catch {
    /* ignore quota / private mode — user can still reveal by re-entering */
  }
}

export function loadCommitment(
  bountyId: bigint,
  account: Address,
): StoredCommitment | null {
  try {
    const raw = localStorage.getItem(storageKey(bountyId, account));
    return raw ? (JSON.parse(raw) as StoredCommitment) : null;
  } catch {
    return null;
  }
}

export function clearCommitment(bountyId: bigint, account: Address): void {
  try {
    localStorage.removeItem(storageKey(bountyId, account));
  } catch {
    /* ignore quota / private mode */
  }
}

/** All-zero bytes32 — the contract's "no commitment / already revealed" sentinel. */
export const ZERO_BYTES32 = zeroHash;
