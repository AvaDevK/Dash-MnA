// MNA domain constants — mirrors V2 server/src/services/mna/types.ts

const MNA_UNKNOWN_BUCKET = "Unknown";
const INITIATIVE_TYPE_NAME = "Initiative";
const ROADMAP_ITEM_TYPE_NAME = "Roadmap Item";
const EXCLUDED_KEYS = new Set(["MNAC-90"]);
const MNAC_KEY_PREFIX = "MNAC-";

function isMnacKey(key) {
  return key.startsWith(MNAC_KEY_PREFIX);
}

module.exports = { MNA_UNKNOWN_BUCKET, INITIATIVE_TYPE_NAME, ROADMAP_ITEM_TYPE_NAME, EXCLUDED_KEYS, isMnacKey };
