import Link from "next/link";

import { formatLamports } from "../../lib/format";
import { MOCK_DRAWS } from "../../lib/mock-draw";

export default function WinnersPage() {
  const settled = MOCK_DRAWS.filter((draw) => draw.status === "settled");

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl">Winners</h1>
        <p className="text-muted">Mocked settled draws. Payouts are not onchain yet.</p>
      </div>
      <ul className="space-y-3">
        {settled.map((draw) => (
          <li key={draw.id} className="border border-line bg-panel p-4">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-lg">Draw {draw.id}</h2>
              <span className="font-mono text-sm">{formatLamports(draw.potLamports)} SOL</span>
            </div>
            <p className="mt-2 font-mono text-xs text-muted">{draw.winnerWallet}</p>
            <p className="mt-1 text-sm">@{draw.winnerFomo}</p>
            <Link href={`/verify/${draw.id}`} className="mt-3 inline-block text-sm text-accent">
              Verify
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
