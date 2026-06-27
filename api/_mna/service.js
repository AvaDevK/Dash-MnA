// MNA service — mirrors V2 mnaService.ts + completionRollup.ts.
// Pure functions: assembleInitiatives, attachCompletion, computeKpis, applyFilters, buildPayload.

const { EXCLUDED_KEYS, INITIATIVE_TYPE_NAME, ROADMAP_ITEM_TYPE_NAME, isMnacKey, MNA_UNKNOWN_BUCKET } = require("./types");

// ─── Completion rollup (mirrors completionRollup.ts) ─────────────────────────

const COMPLETE_STATUSES = new Set(["done", "closed", "resolved", "cancelled", "canceled"]);

function isComplete(issue) {
  if (issue.statusCategoryKey) return issue.statusCategoryKey === "done";
  return COMPLETE_STATUSES.has((issue.statusName || "").toLowerCase().trim());
}

function collectRecords(ri) {
  const records = new Map();
  for (const linked of ri.linked) {
    if (!records.has(linked.key)) records.set(linked.key, isComplete(linked));
  }
  const stack = [...ri.children];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    if (!records.has(node.key)) records.set(node.key, isComplete(node));
    for (const linked of node.linked) {
      if (!records.has(linked.key)) records.set(linked.key, isComplete(linked));
    }
    for (const child of node.children) stack.push(child);
  }
  return records;
}

function computeRiCompletion(ri) {
  const records = collectRecords(ri);
  if (records.size === 0) return isComplete(ri) ? 100 : 0;
  let complete = 0;
  for (const isDone of records.values()) if (isDone) complete++;
  return (complete / records.size) * 100;
}

function computeInitiativeCompletion(initiative) {
  if (initiative.roadmapItems.length === 0) {
    const pct = isComplete(initiative) ? 100 : 0;
    return { completionPct: pct, pendingPct: 100 - pct };
  }
  let total = 0;
  for (const ri of initiative.roadmapItems) total += computeRiCompletion(ri);
  const completionPct = total / initiative.roadmapItems.length;
  return { completionPct, pendingPct: 100 - completionPct };
}

function attachCompletion(initiatives) {
  for (const initiative of initiatives) {
    for (const ri of initiative.roadmapItems) {
      ri.completionPct = ri.isRoadmapItem ? computeRiCompletion(ri) : null;
    }
    initiative.completionPct = computeInitiativeCompletion(initiative).completionPct;
  }
}

function computePortfolioCompletion(initiatives) {
  if (initiatives.length === 0) return { completionPct: 0, pendingPct: 100 };
  let total = 0;
  for (const i of initiatives) total += i.completionPct;
  const completionPct = total / initiatives.length;
  return { completionPct, pendingPct: 100 - completionPct };
}

// ─── Extraction (mirrors extraction.ts) ──────────────────────────────────────

function extractMnaName(issue, config) {
  // Tier 1: custom field (if configured)
  if (config.mnaNameCustomFieldId && issue.fields) {
    const v = issue.fields[config.mnaNameCustomFieldId];
    if (typeof v === "string" && v.trim()) return { value: v.trim(), source: "custom_field" };
  }
  // Tier 2: label matching MNA-* pattern
  for (const label of issue.labels || []) {
    if (/^MNA-/i.test(label)) return { value: label, source: "label" };
  }
  // Tier 3: pipe-split summary ("DAVO | Reliability..." → "DAVO")
  const summary = issue.summary || "";
  const pipe = summary.indexOf("|");
  if (pipe > 0) return { value: summary.slice(0, pipe).trim(), source: "summary" };
  return { value: "", source: "unknown" };
}

function extractRiBucket(issue, config) {
  // Tier 1: custom field
  if (config.mnaRiCustomFieldId && issue.fields) {
    const v = issue.fields[config.mnaRiCustomFieldId];
    if (typeof v === "string" && v.trim()) return { value: v.trim(), source: "custom_field" };
  }
  // Tier 2: label matching RI\d+
  for (const label of issue.labels || []) {
    const m = label.match(/^(RI\d+)$/i);
    if (m) return { value: m[1].toUpperCase(), source: "label" };
  }
  // Tier 3: extract (RIn) token from summary
  const m = (issue.summary || "").match(/\((RI\d+)\)/i);
  if (m) return { value: m[1].toUpperCase(), source: "summary" };
  return { value: null, source: "unknown" };
}

// ─── Tree assembly (mirrors mnaService.ts assembleInitiatives) ────────────────

function resolveInitiativeName(issue, config) {
  const result = extractMnaName(issue, config);
  if (result.source !== "unknown") return result;
  const trimmed = (issue.summary || "").trim();
  if (trimmed) return { value: trimmed, source: "summary" };
  return { value: MNA_UNKNOWN_BUCKET, source: "unknown" };
}

function indexChildrenByParentKey(issues) {
  const idx = new Map();
  for (const i of issues) {
    if (!i.parentKey) continue;
    const arr = idx.get(i.parentKey) || [];
    arr.push(i);
    idx.set(i.parentKey, arr);
  }
  return idx;
}

function collectLinkedIssuesForNode(node, byKey) {
  const out = [];
  const seen = new Set();
  for (const edge of node.links) {
    const linkedKey = edge.sourceKey === node.key ? edge.targetKey : edge.sourceKey;
    if (linkedKey === node.key || seen.has(linkedKey)) continue;
    seen.add(linkedKey);
    const linked = byKey.get(linkedKey);
    if (!linked) continue;
    out.push({
      key: linked.key,
      summary: linked.summary,
      statusName: linked.statusName,
      statusCategoryKey: linked.statusCategoryKey,
      issueType: linked.issueType,
      linkedFromKey: node.key,
      linkType: edge.normalizedType,
      rawLinkType: edge.rawType,
      direction: edge.direction,
      provenance: edge.provenance,
    });
  }
  const typeOrder = { is_blocked_by: 0, blocks: 1, relates_to: 2, other: 3 };
  out.sort((a, b) => {
    const t = (typeOrder[a.linkType] ?? 3) - (typeOrder[b.linkType] ?? 3);
    return t !== 0 ? t : a.key.localeCompare(b.key);
  });
  return out;
}

function countLinkedInSubtree(linked, children) {
  let total = linked.length;
  const stack = [...children];
  while (stack.length > 0) {
    const n = stack.pop();
    if (!n) break;
    total += n.linked.length;
    for (const c of n.children) stack.push(c);
  }
  return total;
}

function makeEmptyNode(issue) {
  return { key: issue.key, summary: issue.summary, statusName: issue.statusName, statusCategoryKey: issue.statusCategoryKey, issueType: issue.issueType, parentKey: issue.parentKey, isRoadmapItem: false, riBucket: null, riBucketSource: "unknown", children: [], linked: [], completionPct: null };
}

const CHILD_ORDER = new Map([["Epic", 0], ["Story", 1], ["Task", 2], ["Bug", 3], ["Sub-task", 4]]);

function sortChildren(children) {
  children.sort((a, b) => {
    const ao = CHILD_ORDER.get(a.issueType) ?? 99;
    const bo = CHILD_ORDER.get(b.issueType) ?? 99;
    return ao !== bo ? ao - bo : a.key.localeCompare(b.key);
  });
}

function buildTreeNode(issue, byKey, childrenByParent, config, visited) {
  if (visited.has(issue.key)) return makeEmptyNode(issue);
  const nextVisited = new Set(visited);
  nextVisited.add(issue.key);

  const isRi = issue.issueType === ROADMAP_ITEM_TYPE_NAME;
  const ri = isRi
    ? extractRiBucket({ fields: undefined, labels: issue.labels, summary: issue.summary }, config)
    : { value: null, source: "unknown" };

  const children = [];
  for (const child of childrenByParent.get(issue.key) || []) {
    if (EXCLUDED_KEYS.has(child.key)) continue;
    children.push(buildTreeNode(child, byKey, childrenByParent, config, nextVisited));
  }
  sortChildren(children);

  const linked = collectLinkedIssuesForNode(issue, byKey);

  return {
    key: issue.key,
    summary: issue.summary,
    statusName: issue.statusName,
    statusCategoryKey: issue.statusCategoryKey,
    issueType: issue.issueType,
    parentKey: issue.parentKey,
    isRoadmapItem: isRi,
    riBucket: ri.value,
    riBucketSource: ri.source,
    children,
    linked,
    completionPct: null,
  };
}

function sortRoadmapItems(items) {
  items.sort((a, b) => {
    const ai = a.riBucket || "";
    const bi = b.riBucket || "";
    const cmp = ai.localeCompare(bi, undefined, { numeric: true });
    return cmp !== 0 ? cmp : a.key.localeCompare(b.key);
  });
}

function assembleInitiatives(issues, config, sbr = null) {
  const byKey = new Map();
  for (const i of issues) byKey.set(i.key, i);
  const childrenByParent = indexChildrenByParentKey(issues);

  const initiatives = [];
  for (const issue of issues) {
    if (EXCLUDED_KEYS.has(issue.key)) continue;
    if (issue.issueType !== INITIATIVE_TYPE_NAME) continue;
    // When sbr is provided: only direct children of the SBR are top-level initiatives
    if (sbr && issue.parentKey !== sbr) continue;
    // Legacy fallback (no sbr): use MNAC key prefix heuristic
    if (!sbr && !isMnacKey(issue.key)) continue;

    const mnaName = resolveInitiativeName(issue, config);
    const roadmapItems = [];
    for (const child of childrenByParent.get(issue.key) || []) {
      if (EXCLUDED_KEYS.has(child.key)) continue;
      if (child.issueType !== ROADMAP_ITEM_TYPE_NAME) continue;
      roadmapItems.push(buildTreeNode(child, byKey, childrenByParent, config, new Set()));
    }
    sortRoadmapItems(roadmapItems);

    const linked = collectLinkedIssuesForNode(issue, byKey);
    const totalLinkCount = countLinkedInSubtree(linked, roadmapItems);

    initiatives.push({
      key: issue.key,
      summary: issue.summary,
      mnaName: mnaName.value,
      mnaNameSource: mnaName.source,
      statusName: issue.statusName,
      statusCategoryKey: issue.statusCategoryKey,
      assignee: issue.assignee,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      resolutionDate: issue.resolutionDate,
      roadmapItems,
      linked,
      completionPct: 0,
      totalLinkCount,
    });
  }
  initiatives.sort((a, b) => a.mnaName.localeCompare(b.mnaName));
  return initiatives;
}

// ─── Filters + KPIs ──────────────────────────────────────────────────────────

function subtreeHasOpenBlocker(initiative) {
  const layers = [{ linked: initiative.linked, children: initiative.roadmapItems }];
  while (layers.length > 0) {
    const layer = layers.pop();
    if (!layer) break;
    for (const l of layer.linked) {
      if (l.linkType === "is_blocked_by" && !isComplete(l)) return true;
    }
    for (const c of layer.children) layers.push({ linked: c.linked, children: c.children });
  }
  return false;
}

function haystackForInitiative(initiative) {
  const parts = [initiative.key, initiative.summary, initiative.mnaName, initiative.statusName];
  const stack = [...initiative.roadmapItems];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    parts.push(node.key, node.summary, node.statusName, node.riBucket || "");
    for (const l of node.linked) parts.push(l.key, l.summary, l.statusName);
    for (const c of node.children) stack.push(c);
  }
  for (const l of initiative.linked) parts.push(l.key, l.summary, l.statusName);
  return parts.join(" ").toLowerCase();
}

function applyFilters(initiatives, filters) {
  const mnaNames = filters.mnaNames.length === 0 ? null : new Set(filters.mnaNames);
  const ri = filters.ri && filters.ri !== "All" ? filters.ri : null;
  const risk = filters.risk && filters.risk !== "all" ? filters.risk : null;
  const q = (filters.query || "").trim().toLowerCase();

  const out = [];
  for (const initiative of initiatives) {
    if (mnaNames && !mnaNames.has(initiative.mnaName)) continue;
    let visibleRis = initiative.roadmapItems;
    if (ri) visibleRis = visibleRis.filter((r) => r.riBucket === ri);
    if (risk === "blocked" && !subtreeHasOpenBlocker(initiative)) continue;
    if (risk === "gap" || risk === "zero") {
      const isEmpty = visibleRis.length === 0 || visibleRis.every((r) => r.children.length === 0 && r.linked.length === 0);
      if (!isEmpty) continue;
    }
    if (q && !haystackForInitiative(initiative).includes(q)) continue;
    if (ri && visibleRis.length === 0) continue;
    out.push({ ...initiative, roadmapItems: visibleRis });
  }
  return out;
}

function collectActiveBlockers(initiatives) {
  const out = [];
  for (const initiative of initiatives) {
    const stack = [{ linked: initiative.linked, key: initiative.key, summary: initiative.summary }];
    const nodeStack = [...initiative.roadmapItems];
    // Initiative-level blockers
    for (const l of initiative.linked) {
      if (l.linkType === "is_blocked_by" && !isComplete(l)) {
        out.push({ initiativeKey: initiative.key, initiativeName: initiative.mnaName, attachedToKey: initiative.key, attachedToSummary: initiative.summary, blockerKey: l.key, blockerSummary: l.summary, blockerStatusName: l.statusName, ageDays: null });
      }
    }
    // RI + descendants
    while (nodeStack.length > 0) {
      const node = nodeStack.pop();
      if (!node) break;
      for (const l of node.linked) {
        if (l.linkType === "is_blocked_by" && !isComplete(l)) {
          out.push({ initiativeKey: initiative.key, initiativeName: initiative.mnaName, attachedToKey: node.key, attachedToSummary: node.summary, blockerKey: l.key, blockerSummary: l.summary, blockerStatusName: l.statusName, ageDays: null });
        }
      }
      for (const c of node.children) nodeStack.push(c);
    }
  }
  out.sort((a, b) => a.blockerKey.localeCompare(b.blockerKey));
  return out;
}

function computeKpis(initiatives, blockers) {
  const portfolio = computePortfolioCompletion(initiatives);
  let openDependencies = 0;
  let openGaps = 0;
  for (const initiative of initiatives) {
    const stack = [{ linked: initiative.linked, children: initiative.roadmapItems }];
    while (stack.length > 0) {
      const layer = stack.pop();
      if (!layer) break;
      for (const l of layer.linked) {
        if (l.linkType === "blocks" && !isComplete(l)) openDependencies++;
      }
      for (const c of layer.children) stack.push({ linked: c.linked, children: c.children });
    }
    if (initiative.roadmapItems.length === 0) { openGaps++; continue; }
    const allEmpty = initiative.roadmapItems.every((ri) => ri.children.length === 0 && ri.linked.length === 0);
    if (allEmpty) openGaps++;
  }
  return {
    initiativeCompletionPct: Math.round(portfolio.completionPct * 10) / 10,
    pendingPct: Math.round(portfolio.pendingPct * 10) / 10,
    openBlockers: blockers.length,
    openDependencies,
    openGaps,
  };
}

function collectMnaNames(initiatives) {
  const set = new Set();
  for (const i of initiatives) set.add(i.mnaName);
  return [...set].sort((a, b) => a.localeCompare(b));
}

function collectRiBuckets(initiatives) {
  const set = new Set();
  for (const i of initiatives) {
    for (const ri of i.roadmapItems) if (ri.riBucket) set.add(ri.riBucket);
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function buildExtractionTelemetry(initiatives) {
  const empty = { custom_field: 0, label: 0, summary: 0, unknown: 0 };
  const mna = { ...empty };
  const ri = { ...empty };
  let roadmapItemCount = 0;
  for (const initiative of initiatives) {
    mna[initiative.mnaNameSource] = (mna[initiative.mnaNameSource] || 0) + 1;
    for (const r of initiative.roadmapItems) {
      roadmapItemCount++;
      ri[r.riBucketSource] = (ri[r.riBucketSource] || 0) + 1;
    }
  }
  return { initiativeCount: initiatives.length, roadmapItemCount, mnaNameSourceCounts: mna, riBucketSourceCounts: ri };
}

module.exports = {
  assembleInitiatives,
  attachCompletion,
  applyFilters,
  collectActiveBlockers,
  computeKpis,
  collectMnaNames,
  collectRiBuckets,
  buildExtractionTelemetry,
};
