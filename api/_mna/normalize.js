// Issue normalization — mirrors V2 MnaJiraRepository.ts normalizeIssues + buildEdgesForIssue.
// Pure functions: no I/O.

const { EXCLUDED_KEYS } = require("./types");

const PROVENANCE_RANK = { parents_jql: 0, parent_walk: 1, combined_jql: 2, link_expansion: 3 };

function edgeKey(edge) {
  return `${edge.sourceKey}|${edge.targetKey}|${edge.normalizedType}`;
}

function emitEdge(out, edge) {
  const k = edgeKey(edge);
  const prior = out.get(k);
  if (!prior) { out.set(k, edge); return; }
  if (PROVENANCE_RANK[edge.provenance] < PROVENANCE_RANK[prior.provenance]) out.set(k, edge);
}

function canonicalizeRelatesTo(a, b, rawType, direction, provenance) {
  const [sourceKey, targetKey] = a < b ? [a, b] : [b, a];
  return { sourceKey, targetKey, normalizedType: "relates_to", rawType, direction, provenance };
}

function buildEdgesForIssue(issue, provenance, out) {
  const issueKey = issue.key || "";
  if (!issueKey) return;
  const links = issue.fields?.issuelinks || [];
  for (const link of links) {
    const rawType = link.type?.name || "";
    const inwardKey = link.inwardIssue?.key || null;
    const outwardKey = link.outwardIssue?.key || null;
    const lower = rawType.toLowerCase();
    const isBlocksType = lower === "blocks" || lower.includes("block");
    const isRelatesType = lower === "relates" || lower.includes("relate");

    if (isBlocksType) {
      if (inwardKey) emitEdge(out, { sourceKey: issueKey, targetKey: inwardKey, normalizedType: "is_blocked_by", rawType, direction: "inward", provenance });
      if (outwardKey) emitEdge(out, { sourceKey: issueKey, targetKey: outwardKey, normalizedType: "blocks", rawType, direction: "outward", provenance });
      continue;
    }
    const normalizedType = isRelatesType ? "relates_to" : "other";
    if (inwardKey) {
      emitEdge(out, normalizedType === "relates_to"
        ? canonicalizeRelatesTo(issueKey, inwardKey, rawType, "inward", provenance)
        : { sourceKey: issueKey, targetKey: inwardKey, normalizedType, rawType, direction: "inward", provenance });
    }
    if (outwardKey) {
      emitEdge(out, normalizedType === "relates_to"
        ? canonicalizeRelatesTo(issueKey, outwardKey, rawType, "outward", provenance)
        : { sourceKey: issueKey, targetKey: outwardKey, normalizedType, rawType, direction: "outward", provenance });
    }
  }
}

function projectIssue(raw, edgesOwnedByIssue) {
  const key = raw.key;
  if (!key) return null;
  const f = raw.fields || {};
  return {
    key,
    summary: f.summary || "",
    statusName: f.status?.name || "",
    statusCategoryKey: f.status?.statusCategory?.key,
    issueType: f.issuetype?.name || "",
    parentKey: f.parent?.key || null,
    assignee: f.assignee?.displayName || null,
    labels: Array.isArray(f.labels) ? f.labels : [],
    createdAt: f.created || null,
    updatedAt: f.updated || null,
    resolutionDate: f.resolutiondate || null,
    links: edgesOwnedByIssue,
  };
}

/**
 * Combines raw responses from all four fetch layers.
 * @param {Object} input - { parentsRaw, combinedRaw, walkRaw?, expandedRaw? }
 */
function normalizeIssues(input) {
  const parentsRaw = input.parentsRaw || [];
  const combinedRaw = input.combinedRaw || [];
  const walkRaw = input.walkRaw || [];
  const expandedRaw = input.expandedRaw || [];

  const edges = new Map();
  const issueIndex = new Map();

  const ordered = [
    { layer: expandedRaw, provenance: "link_expansion" },
    { layer: combinedRaw, provenance: "combined_jql" },
    { layer: walkRaw, provenance: "parent_walk" },
    { layer: parentsRaw, provenance: "parents_jql" },
  ];
  for (const { layer, provenance } of ordered) {
    for (const issue of layer) {
      if (!issue.key) continue;
      if (EXCLUDED_KEYS.has(issue.key)) continue;
      issueIndex.set(issue.key, issue);
      buildEdgesForIssue(issue, provenance, edges);
    }
  }

  const edgesBySource = new Map();
  for (const edge of edges.values()) {
    const arr = edgesBySource.get(edge.sourceKey) || [];
    arr.push(edge);
    edgesBySource.set(edge.sourceKey, arr);
  }

  const issues = [];
  const keys = [...issueIndex.keys()].sort();
  for (const key of keys) {
    const raw = issueIndex.get(key);
    if (!raw) continue;
    const issue = projectIssue(raw, edgesBySource.get(key) || []);
    if (issue) issues.push(issue);
  }
  return issues;
}

module.exports = { normalizeIssues };
