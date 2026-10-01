import { z } from "zod";

const tokenAmountSchema = z.object({
  amount: z.string().regex(/^\d+$/),
  decimals: z.number().int().nonnegative(),
});

const tokenAccountsSchema = z.object({
  jsonrpc: z.literal("2.0"),
  result: z.object({
    value: z.array(
      z.object({
        account: z.object({
          data: z.object({
            parsed: z.object({
              info: z.object({
                tokenAmount: tokenAmountSchema,
              }),
            }),
          }),
        }),
      }),
    ),
  }),
});

/** Sum `tokenAmount.amount` base units from a getTokenAccountsByOwner jsonParsed result. */
export function parseTokenBalance(data: unknown): bigint {
  const parsed = tokenAccountsSchema.parse(data);
  let total = 0n;
  for (const row of parsed.result.value) {
    total += BigInt(row.account.data.parsed.info.tokenAmount.amount);
  }
  return total;
}
