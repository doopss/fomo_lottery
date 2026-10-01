import { describe, expect, it, vi } from "vitest";

import {
  FomoApiIdentityProvider,
  fomoApiConfigFromEnv,
  parseThesisList,
  parseTrader,
  selectThesis,
  type FomoApiConfig,
} from "./fomoapi.js";

const config: FomoApiConfig = {
  baseUrl: "https://api.fomoapi.io",
  apiKey: "test-key",
  tokenMint: "DrawMint111",
  walletLookupPath: "",
};

const traderFixture = {
  handle: "CryptoKaleo",
  userId: "1f08e6ab-5c73-5443-9225-bfc496cde51f",
  displayName: "K A L E O",
  wallets: {
    solana: "5AhfPStn66hRYoNNDfJHSDgCH7fBbwMQZUECRrhTo62F",
    evm: "0x7b4d16237683fe1765e727eadf99c6f02adf0b59",
  },
  followers: 19967,
};

const thesisFixture = {
  theses: [
    { text: "older note", handle: "CryptoKaleo", ts: "2026-09-01T00:00:00.000Z", likes: 1 },
    { text: "  ", handle: "CryptoKaleo", ts: "2026-09-03T00:00:00.000Z" },
    { text: "newer note", handle: "CryptoKaleo", ts: "2026-09-02T00:00:00.000Z", likes: 4 },
  ],
  source: "live-fomo",
  threshold: 0,
  capturedAt: "2026-09-30T00:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fomoapi parsers", () => {
  it("parses a documented trader payload", () => {
    const trader = parseTrader(traderFixture);
    expect(trader.handle).toBe("CryptoKaleo");
    expect(trader.wallets?.solana).toBe("5AhfPStn66hRYoNNDfJHSDgCH7fBbwMQZUECRrhTo62F");
  });

  it("rejects a trader payload without a handle", () => {
    expect(() => parseTrader({ displayName: "nope" })).toThrow();
  });

  it("parses a documented thesis list and selects the newest non-empty row", () => {
    const list = parseThesisList(thesisFixture);
    const thesis = selectThesis(list, "https://api.fomoapi.io/v2/thesis/user/CryptoKaleo/token/DrawMint111");
    expect(thesis).toEqual({
      text: "newer note",
      postedAt: "2026-09-02T00:00:00.000Z",
      url: "https://api.fomoapi.io/v2/thesis/user/CryptoKaleo/token/DrawMint111",
    });
  });

  it("accepts available:false with no theses", () => {
    const list = parseThesisList({ available: false });
    expect(selectThesis(list, "https://api.fomoapi.io/v2/thesis/token/DrawMint111")).toBeNull();
  });

  it("rejects a thesis row without text", () => {
    expect(() => parseThesisList({ theses: [{ likes: 1 }] })).toThrow();
  });
});

describe("FomoApiIdentityProvider", () => {
  it("fails closed on resolveWallet and does not call the network", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new FomoApiIdentityProvider(
      { ...config, walletLookupPath: "/v2/wallets/{wallet}" },
      fetchImpl,
    );
    const result = await provider.resolveWallet("SomeWallet111");
    expect(result.fomoHandle).toBeNull();
    expect(result.thesis).toBeNull();
    expect(result.raw).toMatchObject({
      wallet: "SomeWallet111",
      error: "unresolved",
      reason: "wallet_lookup_unconfigured",
      walletLookupPathIgnored: "/v2/wallets/{wallet}",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("GETs /v2/users/{handle} with a bearer token", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(traderFixture));
    const provider = new FomoApiIdentityProvider(config, fetchImpl);
    const trader = await provider.getTrader("CryptoKaleo");
    expect(trader.handle).toBe("CryptoKaleo");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.fomoapi.io/v2/users/CryptoKaleo",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ authorization: "Bearer test-key" }) as unknown,
      }),
    );
  });

  it("GETs /v2/thesis/user/{id}/token/{mint} when a mint is passed", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(thesisFixture));
    const provider = new FomoApiIdentityProvider(config, fetchImpl);
    const result = await provider.getThesesForUser("CryptoKaleo", "DrawMint111");
    expect(result.thesis?.text).toBe("newer note");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.fomoapi.io/v2/thesis/user/CryptoKaleo/token/DrawMint111",
      expect.any(Object),
    );
  });

  it("GETs /v2/thesis/token/{mint}", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ available: false }));
    const provider = new FomoApiIdentityProvider(config, fetchImpl);
    const result = await provider.getThesesForToken("DrawMint111");
    expect(result.thesis).toBeNull();
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.fomoapi.io/v2/thesis/token/DrawMint111",
      expect.any(Object),
    );
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ error: "trader not found" }, 404));
    const provider = new FomoApiIdentityProvider(config, fetchImpl);
    await expect(provider.getTrader("missing")).rejects.toThrow(/404/);
  });
});

describe("fomoApiConfigFromEnv", () => {
  it("requires base URL, key, and mint", () => {
    expect(() => fomoApiConfigFromEnv({})).toThrow(/FOMO_API_BASE_URL/);
  });

  it("strips a trailing slash and keeps an empty lookup path", () => {
    const parsed = fomoApiConfigFromEnv({
      FOMO_API_BASE_URL: "https://api.fomoapi.io/",
      FOMO_API_KEY: "k",
      DRAW_MINT: "mint",
    });
    expect(parsed.baseUrl).toBe("https://api.fomoapi.io");
    expect(parsed.walletLookupPath).toBe("");
  });
});
