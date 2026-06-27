// Snowflake MNA fetch — mirrors V2 server/src/services/mna/snowflakeIssueFetch.ts
// Queries DS_PROD_INGEST.JIRA.ISSUES for MNAC issues + cross-project parent walk + link expansion.

const { env } = require("./config");
const { queryRows, hasSnowflakeCredentials } = require("./snowflakeClient");
const { EXCLUDED_KEYS } = require("./types");

const ISSUES_TABLE = `${env.snowflakeDatabase}.${env.snowflakeSchema}.ISSUES`;
// Pre-materialized Dynamic Table — dedicated DASH_MNA schema in ENGOPERATIONS_PROD_MART.
// Segregated from V2's PUBLIC schema. Refreshes every 15 min via Snowflake scheduler.
// Created by: scripts/create-dynamic-table.sql
const DYNAMIC_TABLE = `ENGOPERATIONS_PROD_MART.PUBLIC.DASH_MNA_SBR_HIERARCHY_CACHE`;

const PARENT_WALK_MAX_DEPTH = 5;
const LINK_EXPANSION_MAX_BATCHES = 5;
const LINK_EXPANSION_BATCH_SIZE = 100;
const IN_BATCH_SIZE = 100;

const ISSUE_COLS = `
    KEY,
    SUMMARY,
    STATUS_NAME,
    STATUS_CATEGORY_KEY,
    ISSUE_TYPE,
    PARENT_KEY,
    ASSIGNEE,
    LABELS,
    CREATED,
    UPDATED_DATE,
    RESOLUTION_DATE,
    ISSUE_LINKS_RAW
`;

// Columns for the raw ISSUES table (computed via FIELDS semi-structured)
const ISSUE_SELECT = `
  SELECT
    KEY,
    SUMMARY,
    STATUS_NAME,
    FIELDS:"status":"statusCategory":"key"::STRING AS STATUS_CATEGORY_KEY,
    COALESCE(ISSUE_TYPE, FIELDS:"issuetype":"name"::STRING) AS ISSUE_TYPE,
    FIELDS:"parent":"key"::STRING AS PARENT_KEY,
    FIELDS:"assignee":"displayName"::STRING AS ASSIGNEE,
    FIELDS:"labels" AS LABELS,
    CREATED,
    UPDATED_DATE,
    RESOLUTION_DATE,
    FIELDS:"issuelinks"::STRING AS ISSUE_LINKS_RAW
  FROM ${ISSUES_TABLE}
`;

function str(v) {
  return v == null ? "" : String(v).trim();
}

function parseLabels(raw) {
  if (Array.isArray(raw)) return raw.map(str).filter(Boolean);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(str).filter(Boolean);
    } catch { return []; }
  }
  return [];
}

function parseIssueLinks(raw) {
  if (!raw) return [];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  if (Array.isArray(raw)) return raw;
  return [];
}

function snowflakeRowToRawIssue(row) {
  const key = str(row.KEY ?? row.key);
  if (!key) return null;
  const parentKey = str(row.PARENT_KEY ?? row.parent_key) || null;
  return {
    key,
    fields: {
      summary: str(row.SUMMARY ?? row.summary),
      status: {
        name: str(row.STATUS_NAME ?? row.status_name),
        statusCategory: { key: str(row.STATUS_CATEGORY_KEY ?? row.status_category_key) || undefined },
      },
      issuetype: { name: str(row.ISSUE_TYPE ?? row.issue_type) },
      parent: parentKey ? { key: parentKey } : undefined,
      assignee: str(row.ASSIGNEE ?? row.assignee) ? { displayName: str(row.ASSIGNEE ?? row.assignee) } : null,
      labels: parseLabels(row.LABELS ?? row.labels),
      created: str(row.CREATED ?? row.created) || undefined,
      updated: str(row.UPDATED_DATE ?? row.updated_date) || undefined,
      resolutiondate: str(row.RESOLUTION_DATE ?? row.resolution_date) || null,
      issuelinks: parseIssueLinks(row.ISSUE_LINKS_RAW ?? row.issue_links_raw),
    },
  };
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function placeholders(count) {
  return Array.from({ length: count }, () => "?").join(", ");
}

async function fetchIssuesWhere(clause, binds = []) {
  const sql = `${ISSUE_SELECT} WHERE ${clause}`;
  const rows = await queryRows(sql, binds);
  const out = [];
  for (const row of rows) {
    const issue = snowflakeRowToRawIssue(row);
    if (issue?.key && !EXCLUDED_KEYS.has(issue.key)) out.push(issue);
  }
  return out;
}

// ─── Fast path A: DASH_MNA_SBR_HIERARCHY_CACHE dynamic table ─────────────────
// Full hierarchy in one query (<1s). Only available if admin created the table.
async function fetchFromDynamicTable(sbr) {
  const sql = `SELECT ${ISSUE_COLS} FROM ${DYNAMIC_TABLE} WHERE SBR_KEY = ?`;
  const rows = await queryRows(sql, [sbr]);
  return rows.map(snowflakeRowToRawIssue).filter(Boolean).filter((i) => !EXCLUDED_KEYS.has(i.key));
}

let _dynamicTableAvailable = null;
async function isDynamicTableAvailable() {
  if (_dynamicTableAvailable !== null) return _dynamicTableAvailable;
  try {
    await queryRows(`SELECT 1 FROM ${DYNAMIC_TABLE} LIMIT 1`);
    _dynamicTableAvailable = true;
  } catch {
    _dynamicTableAvailable = false;
  }
  return _dynamicTableAvailable;
}

// ─── Fast path B: ROADMAP_2026_TREE seed ─────────────────────────────────────
// Uses existing V2 table (ENGOPERATIONS_PROD_MART.PUBLIC.ROADMAP_2026_TREE, 3K rows)
// to get SBR → Init → RI keys instantly, then fetches full issue data + children
// in targeted batches. ~5-15s vs the current 4-layer blind scan (~4 min).
const ROADMAP_TREE_TABLE = "ENGOPERATIONS_PROD_MART.PUBLIC.ROADMAP_2026_TREE";
let _roadmapTreeAvailable = null;

async function isRoadmapTreeAvailable() {
  if (_roadmapTreeAvailable !== null) return _roadmapTreeAvailable;
  try {
    await queryRows(`SELECT 1 FROM ${ROADMAP_TREE_TABLE} LIMIT 1`);
    _roadmapTreeAvailable = true;
  } catch {
    _roadmapTreeAvailable = false;
  }
  return _roadmapTreeAvailable;
}

async function fetchFromRoadmapTree(sbr) {
  // Step 1: Get all Init + RI keys for this SBR from the 3K-row tree table (~0.5s)
  const treeRows = await queryRows(
    `SELECT SBR_KEY, INIT_KEY, RI_KEY FROM ${ROADMAP_TREE_TABLE} WHERE SBR_KEY = ?`,
    [sbr]
  );
  if (treeRows.length === 0) return null; // SBR not in tree — fall back

  const initKeys = [...new Set(treeRows.map((r) => r.INIT_KEY).filter(Boolean))];
  const riKeys   = [...new Set(treeRows.map((r) => r.RI_KEY).filter(Boolean))];
  const allSeeds = [...new Set([sbr, ...initKeys, ...riKeys])].filter((k) => !EXCLUDED_KEYS.has(k));

  // Step 2: Fetch full issue data for SBR + Inits + RIs in one batched query (~1-2s)
  const seedIssues = await fetchByKeys(allSeeds);
  const seenKeys = new Set(seedIssues.map((i) => i.key).filter(Boolean));

  // Step 3: Fetch Epics (children of RIs) (~1-2s)
  const epicIssues = await fetchByParentKeys(riKeys.filter((k) => !EXCLUDED_KEYS.has(k)));
  const epicKeys = epicIssues.map((i) => i.key).filter((k) => k && !seenKeys.has(k));
  epicIssues.forEach((i) => i.key && seenKeys.add(i.key));

  // Step 4: Fetch Stories/Tasks (children of Epics + direct children of RIs) (~1-2s)
  const storyParentKeys = [...new Set([...epicKeys, ...riKeys])].filter((k) => !EXCLUDED_KEYS.has(k));
  const storyIssues = storyParentKeys.length > 0 ? await fetchByParentKeys(storyParentKeys) : [];
  const storyKeys = storyIssues.map((i) => i.key).filter((k) => k && !seenKeys.has(k));
  storyIssues.forEach((i) => i.key && seenKeys.add(i.key));

  // Step 5: Fetch Sub-tasks (children of Stories) — optional depth
  const subtaskIssues = storyKeys.length > 0 ? await fetchByParentKeys(storyKeys.filter((k) => !EXCLUDED_KEYS.has(k))) : [];

  const all = [...seedIssues, ...epicIssues, ...storyIssues, ...subtaskIssues];
  console.log(`[snowflake] roadmap-tree seed: ${treeRows.length} tree rows → ${all.length} issues for ${sbr}`);
  return all;
}

async function fetchMnacSeed(sbr) {
  // For SBR-356 (MNAC project), mirror V2's faster project-key filter.
  // For other SBRs, fall back to parent-key traversal.
  if (sbr === "SBR-356") {
    return fetchIssuesWhere(`FIELDS:"project":"key"::STRING = 'MNAC' AND KEY != 'MNAC-90'`);
  }
  return fetchIssuesWhere(`FIELDS:"parent":"key"::STRING = ? OR KEY = ?`, [sbr, sbr]);
}

async function fetchByParentKeys(parentKeys) {
  if (parentKeys.length === 0) return [];
  const out = [];
  for (const batch of chunk(parentKeys, IN_BATCH_SIZE)) {
    const issues = await fetchIssuesWhere(
      `FIELDS:"parent":"key"::STRING IN (${placeholders(batch.length)})`,
      batch
    );
    out.push(...issues);
  }
  return out;
}

async function fetchByKeys(keys) {
  const filtered = keys.filter((k) => k && !EXCLUDED_KEYS.has(k));
  if (filtered.length === 0) return [];
  const out = [];
  for (const batch of chunk(filtered, IN_BATCH_SIZE)) {
    const issues = await fetchIssuesWhere(`KEY IN (${placeholders(batch.length)})`, batch);
    out.push(...issues);
  }
  return out;
}

function collectLinkTargetKeys(layers, seenKeys) {
  const targets = new Set();
  for (const issue of layers) {
    for (const link of issue.fields?.issuelinks || []) {
      const inK = link.inwardIssue?.key;
      const outK = link.outwardIssue?.key;
      if (inK && !seenKeys.has(inK) && !EXCLUDED_KEYS.has(inK)) targets.add(inK);
      if (outK && !seenKeys.has(outK) && !EXCLUDED_KEYS.has(outK)) targets.add(outK);
    }
  }
  return [...targets];
}

async function fetchParentWalk(initialFrontier, seenKeys) {
  const out = [];
  let frontier = initialFrontier.filter((k) => !EXCLUDED_KEYS.has(k));
  for (let depth = 0; depth < PARENT_WALK_MAX_DEPTH; depth++) {
    if (frontier.length === 0) break;
    const batchIssues = await fetchByParentKeys(frontier);
    const newKeys = new Set();
    for (const issue of batchIssues) {
      if (!issue.key || seenKeys.has(issue.key)) continue;
      seenKeys.add(issue.key);
      newKeys.add(issue.key);
      out.push(issue);
    }
    if (newKeys.size === 0) break;
    frontier = [...newKeys];
  }
  return out;
}

async function fetchLinkExpansion(fetchedLayers, seenKeys) {
  const flat = fetchedLayers.flat();
  let targets = collectLinkTargetKeys(flat, seenKeys);
  if (targets.length === 0) return [];
  const out = [];
  let batchesFetched = 0;
  while (targets.length > 0 && batchesFetched < LINK_EXPANSION_MAX_BATCHES) {
    const batch = targets.slice(0, LINK_EXPANSION_BATCH_SIZE);
    targets = targets.slice(LINK_EXPANSION_BATCH_SIZE);
    const issues = await fetchByKeys(batch);
    for (const issue of issues) {
      if (!issue.key || seenKeys.has(issue.key)) continue;
      seenKeys.add(issue.key);
      out.push(issue);
    }
    batchesFetched++;
  }
  return out;
}

async function fetchAllMnacIssuesFromSnowflake(sbr = "SBR-356") {
  if (!hasSnowflakeCredentials()) throw new Error("Snowflake credentials are not configured");

  // Fast path: Dynamic Table pre-materializes the full hierarchy in one query (<1s)
  if (await isDynamicTableAvailable()) {
    try {
      const allIssues = await fetchFromDynamicTable(sbr);
      if (allIssues.length > 0) {
        console.log(`[snowflake] Dynamic Table hit: ${allIssues.length} issues for ${sbr}`);
        // Dynamic table already contains the full hierarchy — no walk/expansion needed
        // Treat all issues as parentsRaw so normalizeIssues builds edges from them
        return { parentsRaw: allIssues, combinedRaw: [], walkRaw: [], expandedRaw: [] };
      }
      // Table exists but no rows for this SBR — fall through to live query
      console.warn(`[snowflake] Dynamic Table has 0 rows for ${sbr}, falling back to live query`);
    } catch (dtErr) {
      _dynamicTableAvailable = false; // mark as unavailable so we don't retry
      console.warn(`[snowflake] Dynamic Table query failed: ${dtErr.message}`);
    }
  }

  // Fast path B: ROADMAP_2026_TREE seed — uses existing V2 table to get SBR→Init→RI keys
  // instantly, then fetches full issue data + children in targeted batches (~10-15s vs 4min)
  if (await isRoadmapTreeAvailable()) {
    try {
      const allIssues = await fetchFromRoadmapTree(sbr);
      if (allIssues && allIssues.length > 0) {
        return { parentsRaw: allIssues, combinedRaw: [], walkRaw: [], expandedRaw: [] };
      }
      console.warn(`[snowflake] ROADMAP_2026_TREE has 0 rows for ${sbr}, falling back to 4-layer scan`);
    } catch (treeErr) {
      _roadmapTreeAvailable = false;
      console.warn(`[snowflake] ROADMAP_2026_TREE seed failed: ${treeErr.message}`);
    }
  }

  // Slow path: 4-layer live query (full blind scan — fallback only)
  const parentsRaw = await fetchMnacSeed(sbr);
  const seenKeys = new Set();
  for (const issue of parentsRaw) if (issue.key) seenKeys.add(issue.key);
  const linkTargets = collectLinkTargetKeys(parentsRaw, seenKeys);
  const combinedRaw = await fetchByKeys(linkTargets);
  for (const issue of combinedRaw) if (issue.key) seenKeys.add(issue.key);
  const walkRaw = await fetchParentWalk([...seenKeys], seenKeys);
  const expandedRaw = await fetchLinkExpansion([parentsRaw, combinedRaw, walkRaw], seenKeys);
  return { parentsRaw, combinedRaw, walkRaw, expandedRaw };
}

async function probeMnacIssueCount(sbr = "SBR-356") {
  if (await isDynamicTableAvailable()) {
    try {
      const rows = await queryRows(`SELECT COUNT(*) AS C FROM ${DYNAMIC_TABLE} WHERE SBR_KEY = ?`, [sbr]);
      return Number(rows[0]?.C ?? 0);
    } catch { /* fall through */ }
  }
  if (await isRoadmapTreeAvailable()) {
    try {
      const rows = await queryRows(`SELECT COUNT(*) AS C FROM ${ROADMAP_TREE_TABLE} WHERE SBR_KEY = ?`, [sbr]);
      return Number(rows[0]?.C ?? 0);
    } catch { /* fall through */ }
  }
  const rows = await queryRows(
    `SELECT COUNT(*) AS C FROM ${ISSUES_TABLE} WHERE FIELDS:"parent":"key"::STRING = ? OR KEY = ?`,
    [sbr, sbr]
  );
  return Number(rows[0]?.C ?? 0);
}

module.exports = { fetchAllMnacIssuesFromSnowflake, probeMnacIssueCount, hasSnowflakeCredentials };
