export type {
  IdentityProvider,
  ResolvedIdentity,
  Thesis,
} from "./identity/types.js";
export {
  FomoApiIdentityProvider,
  fomoApiConfigFromEnv,
  parseThesisList,
  parseTrader,
  selectThesis,
} from "./identity/fomoapi.js";
export type { FomoApiConfig, ThesisList, Trader } from "./identity/fomoapi.js";

export {
  DEFAULT_BONUS_ENTRIES,
  DEFAULT_MIN_HOLD_USD_CENTS,
  DEFAULT_MIN_WINDOW_BUY_USD_CENTS,
  defaultEligibilityConfig,
  evaluateEligibility,
} from "./rules.js";
export type {
  DrawWindow,
  EligibilityBuyer,
  EligibilityConfig,
  EligibilityFlag,
  EligibilityResult,
  EligibilitySwap,
  FailReason,
} from "./rules.js";

export { buildMerkleTree, entryLeafPreimage, verifyProof, winnerIndex } from "./merkle.js";
export type { MerkleEntrant, MerkleLeaf, MerkleProof, MerkleTreeResult } from "./merkle.js";
