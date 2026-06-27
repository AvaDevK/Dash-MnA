// Snowflake MNA fetch — mirrors V2 server/src/services/mna/snowflakeIssueFetch.ts
// Queries DS_PROD_INGEST.JIRA.ISSUES for MNAC issues + cross-project parent walk + link expansion.

const { env } = require("./config");
const { queryRows, hasSnowflakeCredentials } = require("./snowflakeClient");
const { EXCLUDED_KEYS } = require("./types");

const ISSUES_TABLE = `${env.snowflakeDatabase}.${env.snowflakeSchema}.ISSUES`;
// Pre-materialized Dynamic Table — dedicated DASH_MNA schema in ENGOPERATIONS_PROD_MART.
// Segregated from V2's PUBLIC schema. Refreshes every 15 min via Snowflake scheduler.
// Created by: scripts/create-dynamic-table.sql
const DYNAMIC_TABLE = `ENGOPERATIONS_PROD_MART.DASH_MNA.SBR_HIERARCHY_CACHE`;

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

// Fast path: query pre-materialized Dynamic Table (created by scripts/create-dynamic-table.js)
// Returns ALL hierarchy issues in one query — no parent walk or link expansion needed.
async function fetchFromDynamicTable(sbr) {
  const sql = `SELECT ${ISSUE_COLS} FROM ${DYNAMIC_TABLE} WHERE SBR_KEY = ?`;
  const rows = await queryRows(sql, [sbr]);
  return rows.map(snowflakeRowToRawIssue).filter(Boolean).filter((i) => !EXCLUDED_KEYS.has(i.key));
}

let _dynamicTableAvailable = null; // null = unknown, true/false = cached result

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

async function fetchMnacSeed(sbr) {
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

  // Slow path: 4-layer live query
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
  // Use Dynamic Table for health check if available (much faster)
  if (await isDynamicTableAvailable()) {
    try {
      const rows = await queryRows(`SELECT COUNT(*) AS C FROM ${DYNAMIC_TABLE} WHERE SBR_KEY = ?`, [sbr]);
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
