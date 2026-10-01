import { describe, expect, it } from "vitest";

import { buildMerkleTree, verifyProof, winnerIndex } from "./merkle.js";

const wallets = [
  "Wa11etCcc11111111111111111111111111111111",
  "Wa11etAaa11111111111111111111111111111111",
  "Wa11etBbb11111111111111111111111111111111",
];

describe("buildMerkleTree", () => {
  it("is independent of input order", () => {
    const forward = buildMerkleTree(wallets);
    const reversed = buildMerkleTree([...wallets].reverse());
    expect(reversed.root).toBe(forward.root);
    expect(forward.leaves.map((leaf) => leaf.wallet)).toEqual([...wallets].sort());
  });

  it("builds a proof that verifies for every leaf, including an odd count", () => {
    const tree = buildMerkleTree(wallets);
    expect(tree.leaves).toHaveLength(3);
    for (const leaf of tree.leaves) {
      const proof = tree.proofs[leaf.wallet];
      expect(proof).toBeDefined();
      if (proof === undefined) {
        continue;
      }
      expect(verifyProof(leaf.wallet, proof, tree.root)).toBe(true);
    }
  });

  it("uses the leaf hash as the root for a single entrant", () => {
    const only = wallets[0];
    if (only === undefined) {
      throw new Error("fixture missing");
    }
    const tree = buildMerkleTree([only]);
    const proof = tree.proofs[only];
    expect(tree.leaves[0]?.leaf).toBe(tree.root);
    expect(proof?.siblings).toEqual([]);
    if (proof !== undefined) {
      expect(verifyProof(only, proof, tree.root)).toBe(true);
    }
  });

  it("rejects a tampered proof", () => {
    const tree = buildMerkleTree(wallets);
    const wallet = tree.leaves[0]?.wallet;
    const proof = wallet === undefined ? undefined : tree.proofs[wallet];
    expect(wallet).toBeDefined();
    expect(proof).toBeDefined();
    if (wallet === undefined || proof === undefined) {
      return;
    }
    const tampered = { ...proof, siblings: proof.siblings.map(() => "00") };
    expect(verifyProof(wallet, tampered, tree.root)).toBe(false);
  });

  it("throws on an empty list and on duplicates", () => {
    expect(() => buildMerkleTree([])).toThrow(/zero entrants/);
    const wallet = wallets[0];
    if (wallet === undefined) {
      throw new Error("fixture missing");
    }
    expect(() => buildMerkleTree([wallet, wallet])).toThrow(/Duplicate/);
  });
});

describe("winnerIndex", () => {
  it("is randomness mod count", () => {
    expect(winnerIndex(10n, 3)).toBe(1);
    expect(winnerIndex(0n, 5)).toBe(0);
    expect(winnerIndex(6n, 3)).toBe(0);
  });

  it("rejects an empty draw and negative randomness", () => {
    expect(() => winnerIndex(1n, 0)).toThrow(/count/);
    expect(() => winnerIndex(-1n, 3)).toThrow(/non-negative/);
  });
});
