import { readFileSync } from "node:fs";

import { FomoApiIdentityProvider, fomoApiConfigFromEnv } from "@draw/shared";

interface IdentityRow {
  wallet: string;
  handle: string;
  thesis: string;
  postedAt: string;
  url: string;
  buyUsd: string;
  holding: string;
}

export function parseWalletCsv(text: string): string[] {
  const wallets: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const cell = (line.split(",")[0] ?? "").trim().replace(/^"|"$/g, "");
    if (wallets.length === 0 && cell.toLowerCase() === "wallet") {
      continue;
    }
    if (cell.length > 0) {
      wallets.push(cell);
    }
  }
  return wallets;
}

function printSummary(rows: IdentityRow[]): void {
  const resolved = rows.filter((row) => row.handle !== "").length;
  const withThesis = rows.filter((row) => row.thesis === "yes").length;
  console.log("\nSummary");
  console.log(`wallets: ${rows.length}`);
  console.log(`resolved fomo account: ${resolved}`);
  console.log(`thesis present: ${withThesis}`);
  console.log(`unresolved: ${rows.length - resolved}`);
  console.log("buy >= $5: not checked (no indexer in M0)");
  console.log("holding at snapshot: not checked (no RPC in M0)");
}

async function main(): Promise<void> {
  const csvPath = process.argv[2];
  if (csvPath === undefined || csvPath.length === 0) {
    console.error("Usage: node dist/scripts/validate-identities.js <wallets.csv>");
    process.exitCode = 1;
    return;
  }

  const wallets = parseWalletCsv(readFileSync(csvPath, "utf8"));
  const provider = new FomoApiIdentityProvider(fomoApiConfigFromEnv());
  const rows: IdentityRow[] = [];

  for (const wallet of wallets) {
    try {
      const identity = await provider.resolveWallet(wallet);
      rows.push({
        wallet,
        handle: identity.fomoHandle ?? "",
        thesis: identity.thesis === null ? "no" : "yes",
        postedAt: identity.thesis?.postedAt ?? "",
        url: identity.thesis?.url ?? "",
        buyUsd: "not checked",
        holding: "not checked",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      rows.push({
        wallet,
        handle: "",
        thesis: "error",
        postedAt: "",
        url: message,
        buyUsd: "not checked",
        holding: "not checked",
      });
    }
  }

  console.table(rows);
  printSummary(rows);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(message);
  process.exitCode = 1;
});
