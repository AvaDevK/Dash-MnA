/**
 * GET /api/sbr-list — returns active SBRs from Jira.
 * JQL: issueKey ~ "SBR*" AND "Big Rocks to Succeed" IS NOT EMPTY AND statusCategory != Done ORDER BY created DESC
 * Cached in-memory for 30 minutes (list changes rarely).
 */

const JIRA_BASE_URL = process.env.JIRA_BASE_URL || "https://avalara.atlassian.net";
const JIRA_EMAIL    = process.env.JIRA_EMAIL    || "";
const JIRA_API_TOKEN= process.env.JIRA_API_TOKEN|| "";
const JQL = `issueKey ~ "SBR*" AND "Big Rocks to Succeed" IS NOT EMPTY AND statusCategory != Done ORDER BY created DESC`;
const FIELDS = ["summary", "status", "assignee"].join(",");

let _cache = null;
let _cachedAt = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 min

async function fetchSbrList() {
  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
  const url = `${JIRA_BASE_URL}/rest/api/3/search/jql`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({ jql: JQL, fields: FIELDS.split(","), maxResults: 200 }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return (data.issues || []).map((issue) => ({
    key: issue.key,
    summary: issue.fields?.summary || "",
    status: issue.fields?.status?.name || "",
    statusCategory: issue.fields?.status?.statusCategory?.name || "",
  }));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "GET only" });
  }

  const forceRefresh = req.query?.refresh === "true";
  const now = Date.now();

  if (!forceRefresh && _cache && now - _cachedAt < CACHE_TTL) {
    res.setHeader("X-Cache", "HIT");
    res.setHeader("X-Cache-Age", String(Math.floor((now - _cachedAt) / 1000)));
    return res.status(200).json({ sbrs: _cache, fromCache: true });
  }

  try {
    const sbrs = await fetchSbrList();
    _cache = sbrs;
    _cachedAt = Date.now();
    res.setHeader("X-Cache", "MISS");
    return res.status(200).json({ sbrs, fromCache: false });
  } catch (err) {
    // Return stale cache if available
    if (_cache) {
      res.setHeader("X-Cache", "STALE");
      return res.status(200).json({ sbrs: _cache, fromCache: true, stale: true });
    }
    return res.status(503).json({ error: "Failed to fetch SBR list", reason: err.message });
  }
};
