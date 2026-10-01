import { buildMerkleTree, winnerIndex } from "@draw/shared";
import { notFound } from "next/navigation";

import { findDraw } from "../../../lib/mock-draw";

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

export default function VerifyPage({
  params,
  searchParams,
}: {
  params: { drawId: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const draw = findDraw(params.drawId);
  if (draw === undefined) {
    notFound();
  }

  const tree = buildMerkleTree(draw.entrants);
  const randomnessRaw = firstParam(searchParams.randomness).trim();
  let computedIndex: number | null = null;
  let computedWallet: string | null = null;
  let randomnessError: string | null = null;

  if (randomnessRaw.length > 0) {
    try {
      if (!/^\d+$/.test(randomnessRaw)) {
        throw new Error("not an integer");
      }
      computedIndex = winnerIndex(BigInt(randomnessRaw), tree.leaves.length);
      computedWallet = tree.leaves[computedIndex]?.wallet ?? null;
    } catch {
      randomnessError = "Randomness must be a non-negative integer.";
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl">Verify draw {draw.id}</h1>
        <p className="text-muted">
          {draw.status === "open" ? "Open window, mocked entrants." : "Settled draw, mocked list."} Root is SHA-256 over
          the sorted wallets.
        </p>
      </div>

      <section className="space-y-2 border border-line bg-panel p-4">
        <p className="text-xs uppercase tracking-wider text-muted">Merkle root</p>
        <p className="break-all font-mono text-sm">{tree.root}</p>
        <p className="text-sm text-muted">{tree.leaves.length} entrants</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg">Entrants</h2>
        <ol className="space-y-1 font-mono text-xs">
          {tree.leaves.map((leaf) => (
            <li key={leaf.wallet}>
              {leaf.index}. {leaf.wallet}
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg">Winner index</h2>
        <p className="text-sm text-muted">index = randomness mod entrant count</p>
        <form method="get" className="flex flex-col gap-3 sm:flex-row">
          <input
            name="randomness"
            defaultValue={randomnessRaw}
            placeholder="Randomness integer"
            className="flex-1 border border-line bg-paper px-3 py-2 font-mono text-sm outline-none focus:border-accent"
          />
          <button type="submit" className="border border-accent px-4 py-2 text-sm text-accent">
            Recompute
          </button>
        </form>
        {randomnessError !== null ? <p className="text-sm text-bad">{randomnessError}</p> : null}
        {computedIndex !== null ? (
          <p className="text-sm">
            Index {computedIndex}
            {computedWallet !== null ? <span className="mt-1 block font-mono text-xs">{computedWallet}</span> : null}
          </p>
        ) : null}
        {draw.winnerWallet !== null ? (
          <p className="text-sm text-muted">
            Recorded winner @{draw.winnerFomo}: <span className="font-mono text-xs">{draw.winnerWallet}</span>
          </p>
        ) : null}
      </section>
    </div>
  );
}
