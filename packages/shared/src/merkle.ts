import { createHash } from "node:crypto";

/**
 * Merkle tree for $DRAW entrant lists.
 *
 * Hash: SHA-256 via node:crypto. Solana's native hash is SHA-256, so the M4
 * program can verify the same bytes without a keccak dependency.
 *
 * Leaf preimage: UTF-8 bytes of `${wallet}:${entryIndex}`. Wallets are sorted
 * lexicographically (base58 is ASCII, so UTF-16 code-unit order matches byte
 * order), and a wallet's entries are numbered from 0. M4 must hash that same
 * string. One wallet can hold several entries; the leaves are distinct.
 * Raw 32-byte pubkeys would need a base58 decoder, which this repo does not depend on.
 *
 * Internal nodes: SHA-256(left || right) in tree order. Pairs are not sorted.
 * An odd level duplicates the last node, so the last hash is combined with itself.
 * An empty entrant list throws. Zero entrants roll the pot over and do not commit a root.
 */

export interface MerkleProof {
  leaf: string;
  siblings: string[];
  /** Where the sibling sits relative to the current node. */
  directions: Array<"left" | "right">;
}

export interface MerkleEntrant {
  wallet: string;
  entryCount: number;
}

export interface MerkleLeaf {
  wallet: string;
  entryIndex: number;
  /** Position of this leaf in the sorted tree. */
  index: number;
  leaf: string;
}

export function entryLeafPreimage(wallet: string, entryIndex: number): string {
  return `${wallet}:${entryIndex}`;
}

export interface MerkleTreeResult {
  root: string;
  leaves: MerkleLeaf[];
  proofs: Record<string, MerkleProof>;
}

function sha256(data: Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

interface WorkingNode {
  hash: Buffer;
  leafIndexes: number[];
}

export function buildMerkleTree(entrants: readonly MerkleEntrant[]): MerkleTreeResult {
  if (entrants.length === 0) {
    throw new Error("Cannot build a Merkle tree with zero entrants");
  }

  const sorted = [...entrants].sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));
  for (let i = 0; i < sorted.length; i += 1) {
    const entrant = sorted[i];
    if (entrant === undefined) {
      throw new Error("missing entrant");
    }
    if (!Number.isInteger(entrant.entryCount) || entrant.entryCount < 1) {
      throw new Error("entryCount must be a positive integer");
    }
    if (i > 0 && entrant.wallet === sorted[i - 1]?.wallet) {
      throw new Error("Duplicate wallet in entrant list");
    }
  }

  const leaves: MerkleLeaf[] = [];
  for (const entrant of sorted) {
    for (let entryIndex = 0; entryIndex < entrant.entryCount; entryIndex += 1) {
      leaves.push({
        wallet: entrant.wallet,
        entryIndex,
        index: leaves.length,
        leaf: sha256(Buffer.from(entryLeafPreimage(entrant.wallet, entryIndex), "utf8")).toString("hex"),
      });
    }
  }

  const proofs: Record<string, MerkleProof> = {};
  for (const leaf of leaves) {
    proofs[entryLeafPreimage(leaf.wallet, leaf.entryIndex)] = { leaf: leaf.leaf, siblings: [], directions: [] };
  }

  let level: WorkingNode[] = leaves.map((leaf, index) => ({
    hash: Buffer.from(leaf.leaf, "hex"),
    leafIndexes: [index],
  }));

  while (level.length > 1) {
    const next: WorkingNode[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      if (left === undefined) {
        throw new Error("missing merkle node");
      }
      const duplicated = i + 1 >= level.length;
      const right = duplicated ? { hash: Buffer.from(left.hash), leafIndexes: [] } : level[i + 1];
      if (right === undefined) {
        throw new Error("missing merkle node");
      }

      for (const leafIndex of left.leafIndexes) {
        const leaf = leaves[leafIndex];
        const proof = leaf === undefined ? undefined : proofs[entryLeafPreimage(leaf.wallet, leaf.entryIndex)];
        if (leaf === undefined || proof === undefined) {
          throw new Error("missing merkle proof");
        }
        proof.siblings.push(right.hash.toString("hex"));
        proof.directions.push("right");
      }
      if (!duplicated) {
        for (const leafIndex of right.leafIndexes) {
          const leaf = leaves[leafIndex];
          const proof = leaf === undefined ? undefined : proofs[entryLeafPreimage(leaf.wallet, leaf.entryIndex)];
          if (leaf === undefined || proof === undefined) {
            throw new Error("missing merkle proof");
          }
          proof.siblings.push(left.hash.toString("hex"));
          proof.directions.push("left");
        }
      }

      next.push({
        hash: sha256(Buffer.concat([left.hash, right.hash])),
        leafIndexes: duplicated ? left.leafIndexes : [...left.leafIndexes, ...right.leafIndexes],
      });
    }
    level = next;
  }

  const rootNode = level[0];
  if (rootNode === undefined) {
    throw new Error("missing merkle root");
  }

  return { root: rootNode.hash.toString("hex"), leaves, proofs };
}

export function verifyProof(wallet: string, entryIndex: number, proof: MerkleProof, root: string): boolean {
  if (!Number.isInteger(entryIndex) || entryIndex < 0) {
    return false;
  }
  if (proof.siblings.length !== proof.directions.length) {
    return false;
  }
  let hash = sha256(Buffer.from(entryLeafPreimage(wallet, entryIndex), "utf8"));
  if (hash.toString("hex") !== proof.leaf) {
    return false;
  }
  for (let i = 0; i < proof.siblings.length; i += 1) {
    const siblingHex = proof.siblings[i];
    const direction = proof.directions[i];
    if (siblingHex === undefined || direction === undefined || !/^[0-9a-f]+$/i.test(siblingHex) || siblingHex.length % 2 !== 0) {
      return false;
    }
    const sibling = Buffer.from(siblingHex, "hex");
    hash = direction === "right" ? sha256(Buffer.concat([hash, sibling])) : sha256(Buffer.concat([sibling, hash]));
  }
  return hash.toString("hex") === root;
}

/** `randomness mod count`. Count is the entrant list length. */
export function winnerIndex(randomness: bigint, count: number): number {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error("count must be a positive integer");
  }
  if (randomness < 0n) {
    throw new Error("randomness must be non-negative");
  }
  return Number(randomness % BigInt(count));
}
