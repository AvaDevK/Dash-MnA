// Vercel Node serverless function. Pulls the full SBR hierarchy from Jira and returns CSV
// in the schema the dashboard understands. Auth: Atlassian Cloud Basic Auth.
// Env vars: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN

const CSV_HEADERS = [
  "sbr_key", "sbr_title", "sbr_status",
  "initiative_key", "initiative_title", "initiative_status",
  "roadmap_key", "roadmap_title", "roadmap_status",
  "epic_key", "epic_title", "epic_status",
  "story_key", "story_title", "story_status", "story_issuetype",
  "subtask_key", "subtask_title", "subtask_status", "subtask_issuetype",
  "source_issue_key", "source_issue_title", "source_issue_status", "source_issue_type", "source_issue_level",
  "linked_key", "linked_title", "linked_status", "linked_issuetype",
  "link_direction", "link_type",
  "parent_key", "parent_title", "parent_status",
];

const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const BATCH_SIZE = 80; // safe Jira IN clause limit

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function csvRow(obj) {
  return CSV_HEADERS.map((h) => csvEscape(obj[h] ?? "")).join(",");
}

function detectLevel(issuetypeName = "") {
  const t = issuetypeName.toLowerCase();
  if (t.includes("strategic") || t === "sbr") return "sbr";
  if (t.includes("initiative")) return "initiative";
  if (t.includes("roadmap")) return "roadmap";
  if (t.includes("epic")) return "epic";
  if (t.includes("sub-task") || t.includes("subtask")) return "subtask";
  return "story"; // Story / Task / Bug
}

function toBase(issue) {
  const f = issue.fields || {};
  return {
    key: issue.key,
    title: f.summary || "",
    status: f.status?.name || "",
    issuetype: f.issuetype?.name || "",
    parentKey: f.parent?.key || null,
    issuelinks: f.issuelinks || [],
  };
}

async function jiraPost(baseUrl, authHeader, jql, nextPageToken) {
  const body = { jql, fields: ["summary", "status", "issuetype", "parent", "issuelinks"], maxResults: PAGE_SIZE };
  if (nextPageToken) body.nextPageToken = nextPageToken;
  const resp = await fetch(`${baseUrl}/rest/api/3/search/jql`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: authHeader },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Jira ${resp.status}: ${text.slice(0, 300)}`);
  }
  return resp.json();
}

async function fetchAllByJql(baseUrl, authHeader, jql) {
  const issues = [];
  let nextPageToken = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await jiraPost(baseUrl, authHeader, jql, nextPageToken);
    issues.push(...(data.issues || []));
    if (data.isLast || !data.nextPageToken || !data.issues?.length) break;
    nextPageToken = data.nextPageToken;
  }
  return issues;
}

async function fetchByParents(baseUrl, authHeader, parentKeys) {
  if (!parentKeys.length) return [];
  const results = [];
  for (let i = 0; i < parentKeys.length; i += BATCH_SIZE) {
    const batch = parentKeys.slice(i, i + BATCH_SIZE);
    const jql = `parent in (${batch.map((k) => `"${k}"`).join(",")}) ORDER BY key ASC`;
    results.push(...await fetchAllByJql(baseUrl, authHeader, jql));
  }
  return results;
}

// Walk SBR → Initiatives → RIs → Epics → Stories → Sub-tasks
async function fetchHierarchy(baseUrl, authHeader, sbrKey) {
  // SBR itself
  const sbrRaw = await fetchAllByJql(baseUrl, authHeader, `issuekey = "${sbrKey}"`);
  const sbr = sbrRaw.length ? toBase(sbrRaw[0]) : { key: sbrKey, title: "", status: "", issuetype: "Strategic Priority", parentKey: null, issuelinks: [] };

  // L1: Initiatives
  const l1 = (await fetchByParents(baseUrl, authHeader, [sbrKey])).map(toBase);

  // L2: Roadmap Items under Initiatives
  const l2 = (await fetchByParents(baseUrl, authHeader, l1.map((i) => i.key))).map(toBase);

  // L3 candidates: children of RIs — split into Epics vs direct Stories
  const l3raw = (await fetchByParents(baseUrl, authHeader, l2.map((i) => i.key))).map(toBase);
  const l3epics = l3raw.filter((i) => detectLevel(i.issuetype) === "epic");
  const l3stories = l3raw.filter((i) => !["epic", "subtask"].includes(detectLevel(i.issuetype)));

  // L4: Stories under Epics
  const l4 = (await fetchByParents(baseUrl, authHeader, l3epics.map((i) => i.key))).map(toBase);

  // L5: Sub-tasks under all Stories/Tasks
  const allStories = [...l3stories, ...l4];
  const l5 = (await fetchByParents(baseUrl, authHeader, allStories.map((i) => i.key))).map(toBase);

  // Build lookup maps
  const byKey = new Map();
  const levelOf = new Map();
  const register = (issues, level) => issues.forEach((i) => { byKey.set(i.key, i); levelOf.set(i.key, level); });
  register([sbr], "sbr");
  register(l1, "initiative");
  register(l2, "roadmap");
  register(l3epics, "epic");
  register(allStories, "story");
  register(l5, "subtask");

  return { byKey, levelOf, allIssues: [sbr, ...l1, ...l2, ...l3epics, ...allStories, ...l5] };
}

// Walk up from a key to build full ancestor context
function contextOf(key, byKey, levelOf) {
  const ctx = { sbr: null, initiative: null, roadmap: null, epic: null, story: null, subtask: null };
  let k = key;
  const visited = new Set();
  while (k && !visited.has(k)) {
    visited.add(k);
    const b = byKey.get(k);
    if (!b) break;
    const lv = levelOf.get(k);
    if (lv && !ctx[lv]) ctx[lv] = b;
    k = b.parentKey;
  }
  return ctx;
}

function emitRows(lines, issue, ctx, byKey) {
  const parent = issue.parentKey ? byKey.get(issue.parentKey) : null;
  const base = {
    sbr_key: ctx.sbr?.key || "",
    sbr_title: ctx.sbr?.title || "",
    sbr_status: ctx.sbr?.status || "",
    initiative_key: ctx.initiative?.key || "",
    initiative_title: ctx.initiative?.title || "",
    initiative_status: ctx.initiative?.status || "",
    roadmap_key: ctx.roadmap?.key || "",
    roadmap_title: ctx.roadmap?.title || "",
    roadmap_status: ctx.roadmap?.status || "",
    epic_key: ctx.epic?.key || "",
    epic_title: ctx.epic?.title || "",
    epic_status: ctx.epic?.status || "",
    story_key: ctx.story?.key || "",
    story_title: ctx.story?.title || "",
    story_status: ctx.story?.status || "",
    story_issuetype: ctx.story?.issuetype || "",
    subtask_key: ctx.subtask?.key || "",
    subtask_title: ctx.subtask?.title || "",
    subtask_status: ctx.subtask?.status || "",
    subtask_issuetype: ctx.subtask?.issuetype || "",
    source_issue_key: issue.key,
    source_issue_title: issue.title,
    source_issue_status: issue.status,
    source_issue_type: issue.issuetype,
    source_issue_level: ctx.subtask?.key === issue.key ? "subtask" : ctx.story?.key === issue.key ? "story" : ctx.epic?.key === issue.key ? "epic" : ctx.roadmap?.key === issue.key ? "roadmap" : ctx.initiative?.key === issue.key ? "initiative" : "sbr",
    parent_key: parent?.key || issue.parentKey || "",
    parent_title: parent?.title || "",
    parent_status: parent?.status || "",
  };

  const links = issue.issuelinks;
  if (!links.length) {
    lines.push(csvRow({ ...base, link_type: "NO LINKS" }));
    return;
  }
  for (const link of links) {
    const linkType = link.type?.name || "";
    let direction = "";
    let target = null;
    if (link.outwardIssue) { direction = link.type?.outward || "outward"; target = link.outwardIssue; }
    else if (link.inwardIssue) { direction = link.type?.inward || "inward"; target = link.inwardIssue; }
    if (!target) continue;
    lines.push(csvRow({
      ...base,
      linked_key: target.key,
      linked_title: target.fields?.summary || "",
      linked_status: target.fields?.status?.name || "",
      linked_issuetype: target.fields?.issuetype?.name || "",
      link_direction: direction,
      link_type: linkType,
    }));
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "POST only" });
    return;
  }

  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!baseUrl || !email || !token) {
    res.status(503).json({ error: "Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN in Vercel env vars." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }

  const rawSbr = (body?.sbr || "").toString().trim().toUpperCase();
  const sbrKey = /^[A-Z]+-\d+$/.test(rawSbr) ? rawSbr : null;

  if (!sbrKey) {
    res.status(400).json({ error: "Pass { sbr: 'SBR-356' } in the request body." });
    return;
  }

  const authHeader = `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;

  try {
    const { byKey, levelOf, allIssues } = await fetchHierarchy(baseUrl, authHeader, sbrKey);
    const lines = [CSV_HEADERS.join(",")];
    for (const issue of allIssues) {
      const ctx = contextOf(issue.key, byKey, levelOf);
      emitRows(lines, issue, ctx, byKey);
    }
    const csv = lines.join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${sbrKey}-hierarchy.csv"`);
    res.status(200).send(csv);
  } catch (err) {
    res.status(502).json({ error: `Jira fetch failed: ${err.message || String(err)}` });
  }
};
