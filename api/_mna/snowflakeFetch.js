// Snowflake MNA fetch — mirrors V2 server/src/services/mna/snowflakeIssueFetch.ts
// Queries DS_PROD_INGEST.JIRA.ISSUES for MNAC issues + cross-project parent walk + link expansion.

const { env } = require("./config");
const { queryRows, hasSnowflakeCredentials } = require("./snowflakeClient");
const { EXCLUDED_KEYS } = require("./types");

const ISSUES_TABLE = `${env.snowflakeDatabase}.${env.snowflakeSchema}.ISSUES`;
// Pre-materialized table — created by scripts/create-materialized-cache.sql.
// Refreshed every 15 min by TASK_REFRESH_SBR_HIERARCHY_CACHE stored procedure.
// Gives <1s reads vs 20-60s for a live VIEW or CTE.
// Set _dynamicTableAvailable = true below after running the setup script in Snowflake.
const DYNAMIC_TABLE = `ENGOPERATIONS_DEV_MART.DASH_MNA.SBR_HIERARCHY_CACHE`;

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

// Set to true after running scripts/create-materialized-cache.sql in Snowflake.
// The script creates a real TABLE (pre-materialized, <1s reads) refreshed every 15 min.
// Keep false while the table doesn't exist — falls back to the CTE path automatically.
let _dynamicTableAvailable = true;
async function isDynamicTableAvailable() {
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

// Single-query full hierarchy fetch using server-side CTEs.
// Instead of 8-13 serial round-trips, one query resolves the full hierarchy in Snowflake.
// For SBR-356: uses MNAC project filter (same as V2).
// For any SBR:  uses parent-key JOIN pattern (same as the dynamic table DDL).
function sanitizeSbrKey(sbr) {
  // Allow only SBR-NNN format to prevent SQL injection
  if (!/^[A-Z]+-[0-9]+$/.test(sbr)) throw new Error(`Invalid SBR key: ${sbr}`);
  return sbr;
}

async function fetchAllInOneQuery(sbr) {
  sbr = sanitizeSbrKey(sbr);
  const T = ISSUES_TABLE;
  let sql;

  // Shared CTE fragment: extracts linked issue keys from a set of hierarchy keys
  // using LATERAL FLATTEN on the FIELDS:"issuelinks" variant array.
  // Returns distinct linked keys that are NOT already in the hierarchy.
  const LINK_TARGETS_CTE = (hierKeysCteName) => `
      link_targets AS (
        SELECT DISTINCT v.value:"outwardIssue":"key"::STRING AS LK
        FROM ${T} i
        JOIN ${hierKeysCteName} h ON i.KEY = h.KEY,
        LATERAL FLATTEN(input => i.FIELDS:"issuelinks") v
        WHERE v.value:"outwardIssue":"key"::STRING IS NOT NULL
          AND v.value:"outwardIssue":"key"::STRING NOT IN (SELECT KEY FROM ${hierKeysCteName})
        UNION
        SELECT DISTINCT v.value:"inwardIssue":"key"::STRING
        FROM ${T} i
        JOIN ${hierKeysCteName} h ON i.KEY = h.KEY,
        LATERAL FLATTEN(input => i.FIELDS:"issuelinks") v
        WHERE v.value:"inwardIssue":"key"::STRING IS NOT NULL
          AND v.value:"inwardIssue":"key"::STRING NOT IN (SELECT KEY FROM ${hierKeysCteName})
      ),
      linked_issues AS (
        ${ISSUE_SELECT}
        WHERE KEY IN (SELECT LK FROM link_targets WHERE LK IS NOT NULL)
      )`;

  if (sbr === "SBR-356") {
    // Mirror V2 exactly: project = MNAC gets all MNAC issues (Initiatives + RIs).
    // Then fetch Epics (children of RIs across any project) and Stories via CTEs.
    sql = `
      WITH
      mnac AS (
        ${ISSUE_SELECT}
        WHERE FIELDS:"project":"key"::STRING = 'MNAC'
          AND KEY != 'MNAC-90'
      ),
      ri_keys AS (
        SELECT KEY FROM mnac
        WHERE COALESCE(ISSUE_TYPE, FIELDS:"issuetype":"name"::STRING) = 'Roadmap Item'
      ),
      epics AS (
        ${ISSUE_SELECT}
        WHERE FIELDS:"parent":"key"::STRING IN (SELECT KEY FROM ri_keys)
          AND FIELDS:"issuetype":"name"::STRING = 'Epic'
      ),
      epic_keys AS (SELECT KEY FROM epics),
      stories AS (
        ${ISSUE_SELECT}
        WHERE FIELDS:"parent":"key"::STRING IN (SELECT KEY FROM epic_keys)
          AND FIELDS:"issuetype":"name"::STRING IN ('Story', 'Task', 'Bug', 'Sub-task')
      ),
      stories_direct AS (
        ${ISSUE_SELECT}
        WHERE FIELDS:"parent":"key"::STRING IN (SELECT KEY FROM ri_keys)
          AND FIELDS:"issuetype":"name"::STRING IN ('Story', 'Task', 'Bug')
      ),
      hier_keys AS (
        SELECT KEY FROM mnac
        UNION ALL SELECT KEY FROM epics
        UNION ALL SELECT KEY FROM stories
        UNION ALL SELECT KEY FROM stories_direct
      ),
      ${LINK_TARGETS_CTE("hier_keys")}
      SELECT * FROM mnac
      UNION ALL SELECT * FROM epics
      UNION ALL SELECT * FROM stories
      UNION ALL SELECT * FROM stories_direct
      UNION ALL SELECT * FROM linked_issues
    `;
  } else {
    // Generic SBR: mirror the dynamic table DDL as an inline CTE
    sql = `
      WITH
      l1 AS (
        ${ISSUE_SELECT}
        WHERE FIELDS:"parent":"key"::STRING = '${sbr}'
          AND FIELDS:"issuetype":"name"::STRING = 'Initiative'
      ),
      l2 AS (
        ${ISSUE_SELECT}
        WHERE FIELDS:"parent":"key"::STRING IN (SELECT KEY FROM l1)
          AND FIELDS:"issuetype":"name"::STRING = 'Roadmap Item'
      ),
      l3 AS (
        ${ISSUE_SELECT}
        WHERE FIELDS:"parent":"key"::STRING IN (SELECT KEY FROM l2)
          AND FIELDS:"issuetype":"name"::STRING = 'Epic'
      ),
      l4a AS (
        ${ISSUE_SELECT}
        WHERE FIELDS:"parent":"key"::STRING IN (SELECT KEY FROM l3)
          AND FIELDS:"issuetype":"name"::STRING IN ('Story', 'Task', 'Bug')
      ),
      l4b AS (
        ${ISSUE_SELECT}
        WHERE FIELDS:"parent":"key"::STRING IN (SELECT KEY FROM l2)
          AND FIELDS:"issuetype":"name"::STRING IN ('Story', 'Task', 'Bug')
      ),
      l5 AS (
        ${ISSUE_SELECT}
        WHERE FIELDS:"parent":"key"::STRING IN (SELECT KEY FROM l4a UNION SELECT KEY FROM l4b)
          AND FIELDS:"issuetype":"name"::STRING = 'Sub-task'
      ),
      sbr_issue AS (
        ${ISSUE_SELECT}
        WHERE KEY = '${sbr}'
      ),
      hier_keys AS (
        SELECT KEY FROM sbr_issue
        UNION ALL SELECT KEY FROM l1
        UNION ALL SELECT KEY FROM l2
        UNION ALL SELECT KEY FROM l3
        UNION ALL SELECT KEY FROM l4a
        UNION ALL SELECT KEY FROM l4b
        UNION ALL SELECT KEY FROM l5
      ),
      ${LINK_TARGETS_CTE("hier_keys")}
      SELECT * FROM sbr_issue
      UNION ALL SELECT * FROM l1
      UNION ALL SELECT * FROM l2
      UNION ALL SELECT * FROM l3
      UNION ALL SELECT * FROM l4a
      UNION ALL SELECT * FROM l4b
      UNION ALL SELECT * FROM l5
      UNION ALL SELECT * FROM linked_issues
    `;
  }

  const rows = await queryRows(sql);
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const issue = snowflakeRowToRawIssue(row);
    if (!issue?.key || seen.has(issue.key) || EXCLUDED_KEYS.has(issue.key)) continue;
    seen.add(issue.key);
    out.push(issue);
  }
  console.log(`[snowflake] single-query CTE: ${out.length} issues for ${sbr}`);
  return out;
}

async function fetchMnacSeed(sbr) {
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

  const t0 = Date.now();
  const timing = {};

  // Fast path: Dynamic Table — only active when a TRUE pre-materialized Dynamic Table exists.
  // A regular VIEW is disabled here (same query cost as CTE + fetchLinkExpansion overhead).
  if (await isDynamicTableAvailable()) {
    try {
      const allIssues = await fetchFromDynamicTable(sbr);
      timing.dynamicTableMs = Date.now() - t0;
      if (allIssues.length > 0) {
        console.log(`[snowflake] Dynamic Table: ${allIssues.length} issues in ${timing.dynamicTableMs}ms`);
        const seenKeys = new Set(allIssues.map((i) => i.key).filter(Boolean));
        const expandedRaw = await fetchLinkExpansion([allIssues], seenKeys);
        timing.linkExpansionMs = Date.now() - t0 - timing.dynamicTableMs;
        timing.totalMs = Date.now() - t0;
        timing.path = "dynamic-table";
        return { parentsRaw: allIssues, combinedRaw: [], walkRaw: [], expandedRaw, timing };
      }
      console.warn(`[snowflake] Dynamic Table: 0 rows for ${sbr}, falling back to CTE`);
    } catch (dtErr) {
      _dynamicTableAvailable = false;
      console.warn(`[snowflake] Dynamic Table failed: ${dtErr.message}`);
    }
  }

  // CTE path: single query resolves full hierarchy + linked issues via LATERAL FLATTEN.
  // One Snowflake round-trip — no fetchLinkExpansion needed.
  try {
    const t1 = Date.now();
    const allIssues = await fetchAllInOneQuery(sbr);
    timing.cteMs = Date.now() - t1;
    timing.totalMs = Date.now() - t0;
    timing.path = "cte";
    if (allIssues.length > 0) {
      console.log(`[snowflake] CTE: ${allIssues.length} issues in ${timing.cteMs}ms`);
      return { parentsRaw: allIssues, combinedRaw: [], walkRaw: [], expandedRaw: [], timing };
    }
    console.warn(`[snowflake] CTE returned 0 issues for ${sbr}, falling back to serial scan`);
  } catch (cteErr) {
    console.warn(`[snowflake] CTE failed: ${cteErr.message}, falling back to serial scan`);
  }

  // Slow path: serial scan — last resort only
  console.warn(`[snowflake] Using slow serial scan for ${sbr}`);
  const t2 = Date.now();
  const parentsRaw = await fetchMnacSeed(sbr);
  timing.seedMs = Date.now() - t2;
  const seenKeys = new Set();
  for (const issue of parentsRaw) if (issue.key) seenKeys.add(issue.key);
  const linkTargets = collectLinkTargetKeys(parentsRaw, seenKeys);
  const t3 = Date.now();
  const combinedRaw = await fetchByKeys(linkTargets);
  timing.combineMs = Date.now() - t3;
  for (const issue of combinedRaw) if (issue.key) seenKeys.add(issue.key);
  const t4 = Date.now();
  const walkRaw = await fetchParentWalk([...seenKeys], seenKeys);
  timing.walkMs = Date.now() - t4;
  const t5 = Date.now();
  const expandedRaw = await fetchLinkExpansion([parentsRaw, combinedRaw, walkRaw], seenKeys);
  timing.linkExpansionMs = Date.now() - t5;
  timing.totalMs = Date.now() - t0;
  timing.path = "serial-scan";
  return { parentsRaw, combinedRaw, walkRaw, expandedRaw, timing };
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
