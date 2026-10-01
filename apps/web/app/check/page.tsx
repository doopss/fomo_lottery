import { checkQuery, FAIL_COPY, MOCK_WINDOW, ruleRows } from "../../lib/mock-draw";

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

export default function CheckPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const query = firstParam(searchParams.q).trim();
  const checked = query.length > 0 ? checkQuery(query) : null;
  const rows = checked === null ? [] : ruleRows(checked.buyer, MOCK_WINDOW);

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl">Check eligibility</h1>
        <p className="text-muted">
          Paste a wallet or a fomo handle. Known fixtures use the real rules function. Anything else fails closed as
          unresolved.
        </p>
      </div>

      <form method="get" className="flex flex-col gap-3 sm:flex-row">
        <input
          name="q"
          defaultValue={query}
          placeholder="Wallet or fomo handle"
          className="flex-1 border border-line bg-paper px-3 py-2 font-mono text-sm outline-none focus:border-accent"
        />
        <button type="submit" className="border border-accent px-4 py-2 text-sm text-accent">
          Check
        </button>
      </form>

      {checked !== null ? (
        <section className="space-y-4 border border-line bg-panel p-4">
          <p className="text-sm text-muted">{checked.known ? "Fixture" : "Unknown input, fail closed"}</p>
          <p className={checked.result.eligible ? "text-good" : "text-bad"}>
            {checked.result.eligible
              ? `Eligible — ${checked.result.entryCount} ${checked.result.entryCount === 1 ? "entry" : "entries"}`
              : "Not eligible"}
            {checked.result.failReason !== null ? ` — ${FAIL_COPY[checked.result.failReason]}` : ""}
          </p>
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.label} className="flex items-start justify-between gap-4 border-t border-line pt-2 text-sm">
                <span>
                  <span className={row.pass ? "text-good" : "text-bad"}>{row.pass ? "Pass" : "Fail"}</span>
                  <span className="ml-3">{row.label}</span>
                </span>
                <span className="max-w-[16rem] text-right font-mono text-xs text-muted">{row.detail}</span>
              </li>
            ))}
          </ul>
          {checked.result.flags.length > 0 ? (
            <p className="text-sm text-muted">Flags (do not fail eligibility): {checked.result.flags.join(", ")}</p>
          ) : null}
        </section>
      ) : null}

      <p className="text-xs text-muted">
        Try nova, pebble, quartz, ridge, umber, or Wa11etEee11111111111111111111111111111111. Window{" "}
        {MOCK_WINDOW.start.toISOString()} to {MOCK_WINDOW.end.toISOString()}.
      </p>
    </div>
  );
}
