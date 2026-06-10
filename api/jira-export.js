// Vercel Node serverless function. Pulls Jira issues via JQL and returns CSV
// in the schema the dashboard understands. Auth: Atlassian Cloud Basic Auth
// (email + API token). Configure in Vercel env vars:
//   JIRA_BASE_URL   e.g. https://avalara.atlassian.net
//   JIRA_EMAIL      e.g. service-account@avalara.com
//   JIRA_API_TOKEN  Atlassian API token (https://id.atlassian.com/manage-profile/security/api-tokens)

const CSV_HEADERS = [
  "sbr_key",
  "sbr_title",
  "sbr_status",
  "initiative_key",
  "initiative_title",
  "initiative_status",
  "roadmap_key",
  "roadmap_title",
  "roadmap_status",
  "epic_key",
  "epic_title",
  "epic_status",
  "story_key",
  "story_title",
  "story_status",
  "story_issuetype",
  "subtask_key",
  "subtask_title",
  "subtask_status",
  "subtask_issuetype",
  "source_issue_key",
  "source_issue_title",
  "source_issue_status",
  "source_issue_type",
  "source_issue_level",
  "linked_key",
  "linked_title",
  "linked_status",
  "linked_issuetype",
  "link_direction",
  "link_type",
  "parent_key",
  "parent_title",
  "parent_status",
];

const PAGE_SIZE = 100;
const MAX_PAGES = 50; // hard ceiling: 5000 issues

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function row(obj) {
  return CSV_HEADERS.map((h) => csvEscape(obj[h] ?? "")).join(",");
}

function detectLevel(issuetypeName = "") {
  const t = issuetypeName.toLowerCase();
  if (t.includes("initiative")) return "initiative";
  if (t.includes("roadmap")) return "roadmap";
  if (t.includes("epic")) return "epic";
  if (t.includes("sub-task") || t.includes("subtask")) return "subtask";
  if (t.includes("story") || t.includes("task")) return "story";
  if (t.includes("sbr") || t.includes("strategic")) return "sbr";
  return "story";
}

function placeFields(level, base) {
  const out = {
    source_issue_key: base.key,
    source_issue_title: base.title,
    source_issue_status: base.status,
    source_issue_type: base.issuetype,
    source_issue_level: level,
    parent_key: base.key,
    parent_title: base.title,
    parent_status: base.status,
    roadmap_key: base.key,
    roadmap_title: base.title,
    roadmap_status: base.status,
  };
  if (level === "sbr") {
    out.sbr_key = base.key;
    out.sbr_title = base.title;
    out.sbr_status = base.status;
  } else if (level === "initiative") {
    out.initiative_key = base.key;
    out.initiative_title = base.title;
    out.initiative_status = base.status;
  } else if (level === "epic") {
    out.epic_key = base.key;
    out.epic_title = base.title;
    out.epic_status = base.status;
  } else if (level === "subtask") {
    out.subtask_key = base.key;
    out.subtask_title = base.title;
    out.subtask_status = base.status;
    out.subtask_issuetype = base.issuetype;
  } else if (level === "story") {
    out.story_key = base.key;
    out.story_title = base.title;
    out.story_status = base.status;
    out.story_issuetype = base.issuetype;
  }
  return out;
}

async function jiraSearch(baseUrl, authHeader, jql, startAt) {
  const url = `${baseUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=${PAGE_SIZE}&fields=summary,status,issuetype,issuelinks,parent`;
  const resp = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: authHeader,
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Jira ${resp.status}: ${text.slice(0, 300)}`);
  }
  return resp.json();
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
    res.status(503).json({
      error:
        "Jira env vars not configured. Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN in Vercel.",
    });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  const jql = (body && body.jql) || "issuekey = SBR-356 OR parent = SBR-356";

  const authHeader = `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
  const lines = [CSV_HEADERS.join(",")];

  try {
    let startAt = 0;
    let pages = 0;
    let total = Infinity;
    while (startAt < total && pages < MAX_PAGES) {
      const data = await jiraSearch(baseUrl, authHeader, jql, startAt);
      total = data.total ?? 0;
      const issues = data.issues || [];
      if (issues.length === 0) break;

      for (const issue of issues) {
        const fields = issue.fields || {};
        const base = {
          key: issue.key,
          title: fields.summary || "",
          status: fields.status?.name || "",
          issuetype: fields.issuetype?.name || "",
        };
        const level = detectLevel(base.issuetype);
        const placed = placeFields(level, base);

        const links = fields.issuelinks || [];
        if (!links.length) {
          lines.push(row({ ...placed, link_type: "NO LINKS" }));
          continue;
        }
        for (const link of links) {
          const linkType = link.type?.name || "";
          let direction = "";
          let target = null;
          if (link.outwardIssue) {
            direction = link.type?.outward || "outward";
            target = link.outwardIssue;
          } else if (link.inwardIssue) {
            direction = link.type?.inward || "inward";
            target = link.inwardIssue;
          }
          if (!target) continue;
          lines.push(
            row({
              ...placed,
              linked_key: target.key,
              linked_title: target.fields?.summary || "",
              linked_status: target.fields?.status?.name || "",
              linked_issuetype: target.fields?.issuetype?.name || "",
              link_direction: direction,
              link_type: linkType,
            }),
          );
        }
      }
      startAt += issues.length;
      pages += 1;
    }
  } catch (err) {
    res
      .status(502)
      .json({ error: `Jira request failed: ${err.message || String(err)}` });
    return;
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(lines.join("\n"));
};
