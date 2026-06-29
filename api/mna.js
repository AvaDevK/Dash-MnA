/**
 * GET /api/mna — returns MnaPayload JSON.
 *
 * Query params (all optional):
 *   mna      comma-separated M&A names, e.g. "DAVO,Track1099"
 *   ri       single RI bucket, e.g. "RI1" (or "All")
 *   risk     "all" | "blocked" | "gap" | "zero"
 *   q        free-text search
 *   refresh  "true" forces cache bypass
 *
 * Env vars:
 *   MNA_DATA_SOURCE              "auto" (default) | "jira" | "snowflake"
 *   JIRA_BASE_URL                https://avalara.atlassian.net
 *   JIRA_EMAIL                   service account email
 *   JIRA_API_TOKEN               Atlassian API token
 *   SNOWFLAKE_USER
 *   SNOWFLAKE_ACCOUNT            default AVALARA-AVALARA_AWS_US_WEST_2
 *   SNOWFLAKE_PRIVATE_KEY        base64 or PEM
 *   SNOWFLAKE_PRIVATE_KEY_PATH   path to PEM file (alternative to inline key)
 *   SNOWFLAKE_PRIVATE_KEY_PASSPHRASE
 *   SNOWFLAKE_WAREHOUSE          default ENGOPERATIONS_MAIN_RD_M_WH
 *   SNOWFLAKE_DATABASE           default DS_PROD_INGEST
 *   SNOWFLAKE_SCHEMA             default JIRA
 *   SNOWFLAKE_ROLE
 *   MNA_CACHE_TTL_MS             default 300000 (5 min)
 *   MNA_NAME_CUSTOM_FIELD_ID     optional Jira custom field for MNA name extraction
 *   MNA_RI_CUSTOM_FIELD_ID       optional Jira custom field for RI bucket extraction
 */

const { env } = require("./_mna/config");
const { normalizeIssues } = require("./_mna/normalize");
const { fetchAllMnacIssuesFromJira, hasJiraCredentials } = require("./_mna/jiraFetch");
const { fetchAllMnacIssuesFromSnowflake } = require("./_mna/snowflakeFetch");
const { hasSnowflakeCredentials } = require("./_mna/snowflakeClient");
const { enrichWithLeanIx, applyBusinessLifecycleFallback } = require("./_mna/leanixFetch");
const {
  assembleInitiatives,
  attachCompletion,
  applyFilters,
  collectActiveBlockers,
  computeKpis,
  collectMnaNames,
  collectRiBuckets,
  buildExtractionTelemetry,
} = require("./_mna/service");

// ─── Cache layer (mirrors V2 cacheService strategy) ──────────────────────────
// Strategy: stale-while-revalidate + inflight deduplication + KV persistence.
//
// V2 uses LRUCache + pinned keys + getWithStale (infra/cache.ts).
// Here we use a plain Map (same semantics, no extra dependency) since Vercel
// serverless containers are short-lived and LRU eviction isn't needed.
//
// Request flow:
//   1. Stale in-memory → return immediately, kick background refresh
//   2. KV hit (fresh) → return, warm memory
//   3. Full miss → await buildUniverse, store everywhere

const _cache = new Map(); // key → { universe, fetchedAt }
const _inflight = new Map(); // key → Promise<universe> — deduplicates concurrent fetches

// KV helpers — gracefully no-op when KV_REST_API_URL is not configured
let _kv = null;
function getKv() {
  if (_kv) return _kv;
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  try { _kv = require("@vercel/kv").kv; return _kv; } catch { return null; }
}
async function kvGet(key) {
  const kv = getKv();
  if (!kv) return null;
  try { return await kv.get(key); } catch (e) { console.warn("[kv] GET:", e.message); return null; }
}
async function kvSet(key, value, ttlSec) {
  const kv = getKv();
  if (!kv) return;
  try { await kv.set(key, value, { ex: ttlSec }); } catch (e) { console.warn("[kv] SET:", e.message); }
}

function cacheKey(sbr) { return `dash-mna:v1:${sbr}`; }

async function fetchUniverse(forceRefresh, sbr = "SBR-356") {
  const ttlMs = env.mnaCacheTtlMs;
  const ttlSec = Math.floor(ttlMs / 1000);
  const key = cacheKey(sbr);
  const now = Date.now();

  const mem = _cache.get(sbr);

  if (!forceRefresh && mem?.universe) {
    const ageMs = now - mem.fetchedAt;
    const ageSeconds = Math.floor(ageMs / 1000);

    if (ageMs < ttlMs) {
      // Fresh — serve immediately
      return { universe: mem.universe, fromCache: true, cacheLayer: "memory", ageSeconds };
    }

    // Stale-while-revalidate: serve stale data NOW, refresh in background
    if (!_inflight.has(sbr)) {
      const refresh = _buildAndStore(sbr, key, ttlSec);
      _inflight.set(sbr, refresh);
      refresh.finally(() => _inflight.delete(sbr));
    }
    return { universe: mem.universe, fromCache: true, cacheLayer: "memory-stale", ageSeconds };
  }

  if (!forceRefresh) {
    // Check KV (survives cold starts)
    const kv = await kvGet(key);
    if (kv?.universe && kv.fetchedAt && (now - kv.fetchedAt) < ttlMs) {
      _cache.set(sbr, kv);
      return { universe: kv.universe, fromCache: true, cacheLayer: "kv", ageSeconds: Math.floor((now - kv.fetchedAt) / 1000) };
    }
  }

  // Full miss — deduplicate concurrent fetches
  if (_inflight.has(sbr)) {
    const universe = await _inflight.get(sbr);
    return { universe, fromCache: false, cacheLayer: "inflight", ageSeconds: 0 };
  }

  const build = _buildAndStore(sbr, key, ttlSec);
  _inflight.set(sbr, build);
  try {
    const universe = await build;
    return { universe, fromCache: false, cacheLayer: "none", ageSeconds: 0 };
  } finally {
    _inflight.delete(sbr);
  }
}

async function _buildAndStore(sbr, key, ttlSec) {
  const universe = await buildUniverse(sbr);
  const entry = { universe, fetchedAt: Date.now() };
  _cache.set(sbr, entry);
  kvSet(key, entry, ttlSec).catch(() => {});
  return universe;
}

async function buildUniverse(sbr = "SBR-356") {
  const config = { mnaNameCustomFieldId: env.mnaNameCustomFieldId, mnaRiCustomFieldId: env.mnaRiCustomFieldId };
  const source = env.mnaDataSource;
  let layers;
  let repoHealth;

  if (source === "snowflake") {
    if (!hasSnowflakeCredentials()) throw new Error("Snowflake credentials not configured");
    layers = await withTimeout(fetchAllMnacIssuesFromSnowflake(sbr), 55_000, "Snowflake MNAC fetch");
    repoHealth = { ok: true, sourceLabel: `snowflake · ${sbr}`, lastFetchedAt: new Date().toISOString() };
  } else if (source === "jira") {
    if (!hasJiraCredentials()) throw new Error("JIRA_EMAIL or JIRA_API_TOKEN is not set");
    layers = await fetchAllMnacIssuesFromJira(sbr);
    repoHealth = { ok: true, sourceLabel: `jira · ${sbr}`, lastFetchedAt: new Date().toISOString() };
  } else {
    // auto: try Snowflake directly (no probe round-trip), fall back to Jira on any error
    if (hasSnowflakeCredentials()) {
      try {
        layers = await withTimeout(fetchAllMnacIssuesFromSnowflake(sbr), 55_000, "Snowflake MNAC fetch");
        repoHealth = { ok: true, sourceLabel: `snowflake · ${sbr}`, lastFetchedAt: new Date().toISOString() };
      } catch (snowErr) {
        const reason = snowErr instanceof Error ? snowErr.message : String(snowErr);
        console.warn(`[mna] Snowflake failed — falling back to Jira: ${reason}`);
        if (!hasJiraCredentials()) throw new Error(`Snowflake: ${reason}; Jira fallback: credentials missing`);
        layers = await fetchAllMnacIssuesFromJira(sbr);
        repoHealth = { ok: true, sourceLabel: `jira (snowflake fallback) · ${sbr}`, reason, lastFetchedAt: new Date().toISOString() };
      }
    } else {
      if (!hasJiraCredentials()) throw new Error("No data source configured: set Snowflake or Jira credentials");
      layers = await fetchAllMnacIssuesFromJira(sbr);
      repoHealth = { ok: true, sourceLabel: `jira · ${sbr}`, lastFetchedAt: new Date().toISOString() };
    }
  }

  const issues = normalizeIssues(layers);
  const initiatives = assembleInitiatives(issues, config, sbr);
  attachCompletion(initiatives);

  // LeanIX EoL enrichment — SBR-356 (MNAC) only; business lifecycle fallback always applies.
  if (sbr === "SBR-356") {
    try {
      await withTimeout(enrichWithLeanIx(initiatives), 15_000, "LeanIX enrichment");
    } catch (leanIxErr) {
      console.warn(`[mna] LeanIX enrichment timed out/failed: ${leanIxErr instanceof Error ? leanIxErr.message : leanIxErr}`);
      // enrichWithLeanIx handles its own Snowflake failure gracefully; the business lifecycle
      // fallback inside it still applies. Re-call with empty products path by patching:
      applyBusinessLifecycleFallback(initiatives);
    }
  }

  return {
    initiatives,
    filterOptions: {
      mnaNames: collectMnaNames(initiatives),
      riBuckets: collectRiBuckets(initiatives),
      risks: ["all", "blocked", "gap", "zero"],
    },
    extractionTelemetry: buildExtractionTelemetry(initiatives),
    snowflakeTiming: layers?.timing ?? null,
    repoHealth,
  };
}


// Background pre-warm: after serving a cold SBR, quietly fetch the next 3 from
// the SBR list that aren't already in cache. Sequential with 2s gaps to avoid
// overwhelming the Snowflake warehouse.
const _JIRA_BASE = process.env.JIRA_BASE_URL || "https://avalara.atlassian.net";
let _sbrListCache = null;
let _sbrListAt = 0;

async function _getSbrList() {
  const now = Date.now();
  if (_sbrListCache && now - _sbrListAt < 30 * 60 * 1000) return _sbrListCache;
  try {
    const auth = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString("base64");
    const resp = await fetch(`${_JIRA_BASE}/rest/api/3/search/jql`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ jql: `issueKey ~ "SBR*" AND "Big Rocks to Succeed" IS NOT EMPTY AND statusCategory != Done ORDER BY created DESC`, fields: ["summary"], maxResults: 20 }),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    _sbrListCache = (data.issues || []).map((i) => i.key);
    _sbrListAt = now;
    return _sbrListCache;
  } catch { return []; }
}

async function _warmSiblings(currentSbr) {
  const list = await _getSbrList();
  const candidates = list.filter((k) => k !== currentSbr && !_cache.has(k)).slice(0, 3);
  for (const sbr of candidates) {
    await new Promise((r) => setTimeout(r, 2000)); // 2s gap between fetches
    if (!_cache.has(sbr) && !_inflight.has(sbr)) {
      console.log(`[warm] pre-warming ${sbr}`);
      _buildAndStore(sbr, cacheKey(sbr), Math.floor(env.mnaCacheTtlMs / 1000)).catch(() => {});
    }
  }
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

function parseMnaFilters(query) {
  const mnaRaw = (query.mna || "");
  const mnaNames = mnaRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const ri = (query.ri || "All").trim();
  const riskRaw = (query.risk || "all").trim().toLowerCase();
  const risk = ["blocked", "gap", "zero"].includes(riskRaw) ? riskRaw : "all";
  const q = (query.q || "").trim();
  const sbr = (query.sbr || "SBR-356").trim().toUpperCase();
  return { mnaNames, ri, risk, query: q, sbr };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET,POST");
    return res.status(405).json({ error: "GET or POST only" });
  }

  const query = req.query || {};
  const forceRefresh = query.refresh === "true";
  const filters = parseMnaFilters(query);

  try {
    const { universe, fromCache, cacheLayer, ageSeconds } = await fetchUniverse(forceRefresh, filters.sbr);
    const filtered = applyFilters(universe.initiatives, filters);
    const blockers = collectActiveBlockers(filtered);
    const kpis = computeKpis(filtered, blockers);

    const payload = {
      filters,
      sbr: filters.sbr,
      filterOptions: universe.filterOptions,
      kpis,
      initiatives: filtered,
      blockers,
      extractionTelemetry: universe.extractionTelemetry,
      repoHealth: universe.repoHealth,
      cacheStatus: cacheLayer === "memory-stale" ? "STALE" : fromCache ? "HIT" : "MISS",
      cacheLayer: cacheLayer ?? "none",
      cacheAgeSeconds: ageSeconds,
    };

    res.setHeader("X-Cache", cacheLayer === "memory-stale" ? "STALE" : fromCache ? "HIT" : "MISS");
    res.setHeader("X-Mna-Source", universe.repoHealth?.sourceLabel ?? "unknown");
    res.setHeader("X-Mna-Repo-Ok", String(Boolean(universe.repoHealth?.ok)));
    if (ageSeconds !== null) res.setHeader("X-Cache-Age", String(ageSeconds));
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(payload);

    // After responding, background-warm sibling SBRs that aren't cached yet.
    // Fire-and-forget: errors are swallowed, no effect on the user response.
    if (!fromCache) {
      const siblings = (universe.filterOptions?.mnaNames || [])
        .slice(0, 3)
        .map(() => null); // placeholder — we warm from SBR list instead
      _warmSiblings(filters.sbr).catch(() => {});
    }
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(503).json({ error: "MNA fetch failed", reason: message });
  }
};
