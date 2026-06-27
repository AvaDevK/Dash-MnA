// Jira 4-layer fetch — mirrors V2 MnaJiraRepository.ts fetchAllMnacIssues().
// Uses native fetch (Node 18+). Returns raw issue arrays for normalizeIssues().

const { env } = require("./config");
const { EXCLUDED_KEYS } = require("./types");

const JIRA_FIELDS = ["summary", "status", "issuetype", "parent", "assignee", "labels", "created", "updated", "resolutiondate", "issuelinks"];
const PAGE_SIZE = 100;
const MAX_PAGES = 30;
const PARENT_WALK_MAX_DEPTH = 5;
const LINK_EXPANSION_MAX_BATCHES = 5;
const LINK_EXPANSION_BATCH_SIZE = 100;

function parentInJql(parentKeys) {
  const list = parentKeys.map((k) => `"${k}"`).join(", ");
  return `parent in (${list}) ORDER BY key ASC`;
}

function keyInJql(keys) {
  const list = keys.map((k) => `"${k}"`).join(", ");
  return `key in (${list}) ORDER BY key ASC`;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function hasJiraCredentials() {
  return !!(env.jiraEmail && env.jiraApiToken);
}

function getAuthHeader() {
  return "Basic " + Buffer.from(`${env.jiraEmail}:${env.jiraApiToken}`).toString("base64");
}

function isInvalidFunctionError(err) {
  const status = err?.status || err?.response?.status;
  if (status !== 400) return false;
  const body = err?.body || "";
  return (
    body.includes("invalid_function_name") ||
    body.includes("linkedIssuesOfQuery") ||
    (body.includes("function") && body.includes("not"))
  );
}

async function fetchJql(jql) {
  const url = `${env.jiraBaseUrl}/rest/api/3/search/jql`;
  const auth = getAuthHeader();
  const issues = [];
  const payload = { jql, fields: JIRA_FIELDS, maxResults: PAGE_SIZE };

  for (let page = 0; page < MAX_PAGES; page++) {
    const resp = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const text = await resp.text();
      const err = new Error(`Jira ${resp.status}: ${text.slice(0, 300)}`);
      err.status = resp.status;
      err.body = text;
      throw err;
    }
    const data = await resp.json();
    const batch = data.issues || [];
    issues.push(...batch);
    if (data.isLast || !data.nextPageToken || batch.length === 0) break;
    payload.nextPageToken = data.nextPageToken;
  }
  return issues;
}

async function fetchParentWalk(initialFrontier, seenKeys) {
  const out = [];
  let frontier = initialFrontier.filter((k) => !EXCLUDED_KEYS.has(k));
  for (let depth = 0; depth < PARENT_WALK_MAX_DEPTH; depth++) {
    if (frontier.length === 0) break;
    const newKeys = new Set();
    for (const batch of chunk(frontier, LINK_EXPANSION_BATCH_SIZE)) {
      const issues = await fetchJql(parentInJql(batch));
      for (const issue of issues) {
        if (!issue.key || EXCLUDED_KEYS.has(issue.key) || seenKeys.has(issue.key)) continue;
        seenKeys.add(issue.key);
        newKeys.add(issue.key);
        out.push(issue);
      }
    }
    if (newKeys.size === 0) break;
    frontier = [...newKeys];
  }
  return out;
}

async function fetchLinkExpansion(fetchedLayers, seenKeys) {
  const targets = new Set();
  for (const layer of fetchedLayers) {
    for (const issue of layer) {
      const links = issue.fields?.issuelinks || [];
      for (const link of links) {
        const inK = link.inwardIssue?.key;
        const outK = link.outwardIssue?.key;
        if (inK && !seenKeys.has(inK) && !EXCLUDED_KEYS.has(inK)) targets.add(inK);
        if (outK && !seenKeys.has(outK) && !EXCLUDED_KEYS.has(outK)) targets.add(outK);
      }
    }
  }
  if (targets.size === 0) return [];
  const out = [];
  let batchesFetched = 0;
  for (const batch of chunk([...targets], LINK_EXPANSION_BATCH_SIZE)) {
    if (batchesFetched >= LINK_EXPANSION_MAX_BATCHES) break;
    const issues = await fetchJql(keyInJql(batch));
    for (const issue of issues) {
      if (!issue.key || seenKeys.has(issue.key)) continue;
      seenKeys.add(issue.key);
      out.push(issue);
    }
    batchesFetched++;
  }
  return out;
}

async function fetchAllMnacIssuesFromJira(sbr = "SBR-356") {
  if (!hasJiraCredentials()) throw new Error("JIRA_EMAIL or JIRA_API_TOKEN is not set");

  const PARENTS_JQL = `parent = ${sbr} ORDER BY key ASC`;
  const combJql = (linkFn) => [
    `parent = ${sbr}`,
    ` OR issue in ${linkFn}("parent = ${sbr}", "is blocked by")`,
    ` OR issue in ${linkFn}("parent = ${sbr}", "blocks")`,
    ` OR issue in ${linkFn}("parent = ${sbr}", "relates to")`,
    " ORDER BY key ASC",
  ].join("");

  const [parentsRaw, combinedRaw] = await Promise.all([
    fetchJql(PARENTS_JQL),
    (async () => {
      try {
        return await fetchJql(combJql("linkedIssuesOfQuery"));
      } catch (err) {
        if (isInvalidFunctionError(err)) {
          return await fetchJql(combJql("linkedIssuesOf"));
        }
        throw err;
      }
    })(),
  ]);
  const seenKeys = new Set();
  for (const r of parentsRaw) if (r.key) seenKeys.add(r.key);
  for (const r of combinedRaw) if (r.key) seenKeys.add(r.key);
  const walkRaw = await fetchParentWalk([...seenKeys], seenKeys);
  const expandedRaw = await fetchLinkExpansion([parentsRaw, combinedRaw, walkRaw], seenKeys);
  return { parentsRaw, combinedRaw, walkRaw, expandedRaw };
}

module.exports = { fetchAllMnacIssuesFromJira, hasJiraCredentials };
