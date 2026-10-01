export interface Thesis {
  text: string;
  postedAt: string;
  url: string;
}

export interface ResolvedIdentity {
  fomoHandle: string | null;
  thesis: Thesis | null;
  raw: unknown;
}

export interface IdentityProvider {
  resolveWallet(wallet: string): Promise<ResolvedIdentity>;
}
