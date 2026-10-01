import { describe, expect, it } from "vitest";

import { buildMerkleTree, entryLeafPreimage, verifyProof, winnerIndex } from "./merkle.js";

const wallets = [
  "Wa11etCcc11111111111111111111111111111111",
  "Wa11etAaa11111111111111111111111111111111",
  "Wa11etBbb11111111111111111111111111111111",
];

function oneEach(list: readonly string[]) {
  return list.map((wallet) => ({ wallet, entryCount: 1 }));
}

describe("buildMerkleTree", () => {
  it("is independent of input order", () => {
    const forward = buildMerkleTree(oneEach(wallets));
    const reversed = buildMerkleTree(oneEach([...wallets].reverse()));
    expect(reversed.root).toBe(forward.root);
    expect(forward.leaves.map((leaf) => leaf.wallet)).toEqual([...wallets].sort());
  });

  it("builds a proof that verifies for every leaf, including an odd count", () => {
    const tree = buildMerkleTree(oneEach(wallets));
    expect(tree.leaves).toHaveLength(3);
    for (const leaf of tree.leaves) {
      const proof = tree.proofs[entryLeafPreimage(leaf.wallet, leaf.entryIndex)];
      expect(proof).toBeDefined();
      if (proof === undefined) {
        continue;
      }
      expect(verifyProof(leaf.wallet, leaf.entryIndex, proof, tree.root)).toBe(true);
    }
  });

  it("gives one wallet several distinct entries", () => {
    const wallet = wallets[0];
    if (wallet === undefined) {
      throw new Error("fixture missing");
    }
    const tree = buildMerkleTree([{ wallet, entryCount: 3 }]);
    expect(tree.leaves.map((leaf) => leaf.entryIndex)).toEqual([0, 1, 2]);
    expect(new Set(tree.leaves.map((leaf) => leaf.leaf)).size).toBe(3);
    for (const leaf of tree.leaves) {
      const proof = tree.proofs[entryLeafPreimage(leaf.wallet, leaf.entryIndex)];
      expect(proof).toBeDefined();
      if (proof === undefined) {
        continue;
      }
      expect(verifyProof(leaf.wallet, leaf.entryIndex, proof, tree.root)).toBe(true);
    }
  });

  it("uses the leaf hash as the root for a single entry", () => {
    const only = wallets[0];
    if (only === undefined) {
      throw new Error("fixture missing");
    }
    const tree = buildMerkleTree([{ wallet: only, entryCount: 1 }]);
    const proof = tree.proofs[entryLeafPreimage(only, 0)];
    expect(tree.leaves[0]?.leaf).toBe(tree.root);
    expect(tree.leaves[0]?.entryIndex).toBe(0);
    expect(proof?.siblings).toEqual([]);
    if (proof !== undefined) {
      expect(verifyProof(only, 0, proof, tree.root)).toBe(true);
    }
  });

  it("rejects a tampered proof", () => {
    const tree = buildMerkleTree(oneEach(wallets));
    const leaf = tree.leaves[0];
    const proof = leaf === undefined ? undefined : tree.proofs[entryLeafPreimage(leaf.wallet, leaf.entryIndex)];
    expect(leaf).toBeDefined();
    expect(proof).toBeDefined();
    if (leaf === undefined || proof === undefined) {
      return;
    }
    const tampered = { ...proof, siblings: proof.siblings.map(() => "00") };
    expect(verifyProof(leaf.wallet, leaf.entryIndex, tampered, tree.root)).toBe(false);
  });

  it("throws on an empty list, duplicates, and a zero entry count", () => {
    expect(() => buildMerkleTree([])).toThrow(/zero entrants/);
    const wallet = wallets[0];
    if (wallet === undefined) {
      throw new Error("fixture missing");
    }
    expect(() =>
      buildMerkleTree([
        { wallet, entryCount: 1 },
        { wallet, entryCount: 1 },
      ]),
    ).toThrow(/Duplicate/);
    expect(() => buildMerkleTree([{ wallet, entryCount: 0 }])).toThrow(/entryCount/);
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
