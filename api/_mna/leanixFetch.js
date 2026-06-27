// LeanIX enrichment — ports V2 mnaLeanIxService.ts + mnaBusinessLifecycle.ts.
// Queries PROD_LEANIX.LEANIX.PRODUCT for lifecycle data; falls back to hardcoded business lifecycle.
// Attaches isEndOfLife + lifecycleLabel directly onto each MnaInitiative.

const { queryRows } = require("./snowflakeClient");

const PRODUCT_SQL = `
  SELECT
    NAME,
    DISPLAYNAME,
    STATUS,
    "LIFECYCLE:ENDOFLIFE" AS END_OF_LIFE_DATE,
    "LIFECYCLE:PHASEOUT"  AS PHASE_OUT_DATE,
    "LIFECYCLE:ACTIVE"    AS ACTIVE_DATE
  FROM PROD_LEANIX.LEANIX.PRODUCT
`;

// MNA initiative name → preferred LeanIX PRODUCT.NAME (mirrors mnaLeanIxMatching.ts)
const MNA_LEANIX_PRIMARY = {
  "Business Licenses": "License Management",
  "Oobj Tecnologia": "OOBJ",
  "Oobj": "OOBJ",
  "3CE": "3CE Cross Border Trade Compliance",
  "CrowdReason": "CrowdReason MetaTasker",
  "PaperCrane": "Paper Crane",
  "ATR": "ATR- Avalara Tax Research.",
};

// Hardcoded business lifecycle (mirrors mnaBusinessLifecycle.ts)
// All entries are "retired" — greyed out on the chart
const MNA_BUSINESS_LIFECYCLE = {
  "Impendulo":         { isEndOfLife: true, label: "End of Life — decommission in progress" },
  "Hopscotch":         { isEndOfLife: true, label: "End of Life / Sunset — wind-down in progress" },
  "Business Licenses": { isEndOfLife: true, label: "Legacy — decommissioned / factsheets removed from LeanIX" },
  "Netle":             { isEndOfLife: true, label: "Legacy / Absorbed — no active onboarding" },
  "PaperCrane":        { isEndOfLife: true, label: "Absorbed / Integrated — no standalone production surface" },
};

function normalizeKey(s) {
  return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function isEoLRow(row) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const eol = parseDate(row.END_OF_LIFE_DATE);
  if (eol && eol <= now) return true;
  const phaseOut = parseDate(row.PHASE_OUT_DATE);
  if (phaseOut && phaseOut <= now) return true;
  const status = (row.STATUS || "").toUpperCase();
  if (status.includes("END") && status.includes("LIFE")) return true;
  if (status === "ARCHIVED") return true;
  return false;
}

function bestProductMatch(mnaName, products) {
  // Tier 1: explicit alias
  const alias = MNA_LEANIX_PRIMARY[mnaName];
  if (alias) {
    const aliasNorm = normalizeKey(alias);
    const hit = products.find((p) => normalizeKey(p.NAME) === aliasNorm || normalizeKey(p.DISPLAYNAME) === aliasNorm);
    if (hit) return hit;
  }
  // Tier 2: exact normalized match on NAME or DISPLAYNAME
  const norm = normalizeKey(mnaName);
  return products.find((p) => normalizeKey(p.NAME) === norm || normalizeKey(p.DISPLAYNAME) === norm) || null;
}

async function fetchProducts() {
  const rows = await queryRows(PRODUCT_SQL);
  return rows.filter((r) => r.NAME);
}

async function enrichWithLeanIx(initiatives) {
  let products = [];
  try {
    products = await fetchProducts();
  } catch (err) {
    console.warn("[leanix] Product fetch failed:", err.message || err);
    // Fall through — business lifecycle fallback still applies
  }

  for (const init of initiatives) {
    // Start with business lifecycle (always applies for MNAC-specific names)
    const bizEntry = MNA_BUSINESS_LIFECYCLE[init.mnaName];
    let isEndOfLife = bizEntry?.isEndOfLife ?? false;
    let lifecycleLabel = bizEntry?.label ?? null;
    let leanIxMatchedName = null;

    // LeanIX product match can upgrade to EoL (but not downgrade)
    if (products.length > 0) {
      const product = bestProductMatch(init.mnaName, products);
      if (product && isEoLRow(product)) {
        isEndOfLife = true;
        leanIxMatchedName = product.DISPLAYNAME || product.NAME;
        lifecycleLabel = lifecycleLabel || `End of Life (LeanIX: ${leanIxMatchedName})`;
      }
    }

    init.isEndOfLife = isEndOfLife;
    init.lifecycleLabel = lifecycleLabel;
    init.leanIxMatchedName = leanIxMatchedName;
  }
}

function applyBusinessLifecycleFallback(initiatives) {
  for (const init of initiatives) {
    if (init.isEndOfLife !== undefined) continue; // already enriched
    const bizEntry = MNA_BUSINESS_LIFECYCLE[init.mnaName];
    init.isEndOfLife = bizEntry?.isEndOfLife ?? false;
    init.lifecycleLabel = bizEntry?.label ?? null;
    init.leanIxMatchedName = null;
  }
}

module.exports = { enrichWithLeanIx, applyBusinessLifecycleFallback };
