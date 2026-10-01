import Link from "next/link";

import { Countdown } from "../components/Countdown";
import { formatLamports } from "../lib/format";
import { MOCK_CLOSE_ISO, MOCK_DRAWS, MOCK_POT_LAMPORTS } from "../lib/mock-draw";

export default function HomePage() {
  const open = MOCK_DRAWS.find((draw) => draw.status === "open");
  const entries = open?.entrants.reduce((sum, entrant) => sum + entrant.entryCount, 0) ?? 0;

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <p className="text-xs uppercase tracking-[0.2em] text-accent">Current window</p>
        <h1 className="text-4xl leading-tight">One buyer takes the pot.</h1>
        <p className="max-w-xl text-muted">
          Creator fees from $DRAW fill a prize pot. Each window, one eligible fomo buyer is paid onchain. Figures on
          this page are mocked until the indexer and draw program are live.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <article className="border border-line bg-panel px-4 py-5">
          <p className="text-xs uppercase tracking-wider text-muted">Pot</p>
          <p className="mt-2 font-mono text-2xl">{formatLamports(MOCK_POT_LAMPORTS)} SOL</p>
        </article>
        <article className="border border-line bg-panel px-4 py-5">
          <p className="text-xs uppercase tracking-wider text-muted">Closes</p>
          <p className="mt-2 text-2xl">
            <Countdown endIso={MOCK_CLOSE_ISO} />
          </p>
        </article>
        <article className="border border-line bg-panel px-4 py-5">
          <p className="text-xs uppercase tracking-wider text-muted">Entries</p>
          <p className="mt-2 font-mono text-2xl">{entries}</p>
        </article>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl">How to enter</h2>
        <ol className="list-decimal space-y-2 pl-5 text-muted">
          <li>Hold at least $5 of $DRAW at the snapshot and post a thesis on it. That is one entry.</li>
          <li>Buy at least $5 more during the window for two bonus entries.</li>
        </ol>
        <p className="text-sm text-muted">One fomo account. A window buy does not qualify anyone by itself. An X account is not required.</p>
        <div className="flex gap-3">
          <Link href="/check" className="inline-block border border-accent px-4 py-2 text-sm text-accent">
            Check a wallet
          </Link>
          <Link href="/verify/7" className="inline-block border border-line px-4 py-2 text-sm text-muted">
            Verify this window
          </Link>
        </div>
      </section>
    </div>
  );
}
