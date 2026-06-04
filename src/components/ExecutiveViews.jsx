import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  AlertTriangle,
  Link2,
  ListChecks,
  Database,
  Clock,
  FileSpreadsheet,
} from "lucide-react";
import InfoTip from "@/components/InfoTip";
import JiraLink from "@/components/JiraLink";
import {
  calculateInitiativeCompletion,
  calculatePendingPercent,
  isCompleteStatus,
  initiativeKeyOf,
  roadmapKeyOf,
} from "@/lib/completion";

const pick = (row, keys) => {
  for (const k of keys) if (row[k]) return row[k];
  return "";
};

const BLOCK_RE = /block/i;
const DEP_RE = /(relates to|implements|is implemented by|depends on|caused by|clones)/i;
const GAP_RE = /\[gap\]|gap/i;

function getInitiativeName(row) {
  return (
    pick(row, ["initiative_title", "initiative_name", "mna", "mna_name"]) ||
    (pick(row, ["roadmap_title", "parent_title"])?.split("|")?.[0]?.trim()) ||
    "Unknown"
  );
}

/**
 * Compute everything we need per Initiative in a single pass.
 * Returns: [{ key, name, completion, pending, openGaps, closedGaps,
 *             blockers, dependencies, openEpics, openStories, openTasks,
 *             openSubtasks, openLinked, ris, riKeys, health }]
 */
function computeInitiativeSnapshots(rows) {
  const groups = new Map();

  const groupOf = (key) => {
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name: "",
        riKeys: new Set(),
        seenLinkKeys: new Set(),
        seenIssueKeys: new Set(),
        openEpicKeys: new Set(),
        openStoryKeys: new Set(),
        openTaskKeys: new Set(),
        openSubtaskKeys: new Set(),
        openLinkedKeys: new Set(),
        blockerRows: [],
        depRows: [],
        openGapKeys: new Set(),
        closedGapKeys: new Set(),
      });
    }
    return groups.get(key);
  };

  rows.forEach((r) => {
    const iKey = initiativeKeyOf(r);
    if (!iKey) return;
    const g = groupOf(iKey);
    if (!g.name) g.name = getInitiativeName(r);

    const rk = roadmapKeyOf(r);
    if (rk) g.riKeys.add(rk);

    const epicKey = pick(r, ["epic_key", "epic"]);
    const epicStatus = pick(r, ["epic_status"]);
    if (epicKey && !isCompleteStatus(epicStatus)) g.openEpicKeys.add(epicKey);

    const storyKey = pick(r, ["story_key", "story", "issue_key"]);
    const storyStatus = pick(r, ["story_status", "issue_status"]);
    const storyType = (pick(r, ["story_issuetype"]) || "").toLowerCase();
    if (storyKey && !isCompleteStatus(storyStatus)) {
      if (storyType.includes("task") && !storyType.includes("sub")) {
        g.openTaskKeys.add(storyKey);
      } else {
        g.openStoryKeys.add(storyKey);
      }
    }

    const subtaskKey = pick(r, ["subtask_key"]);
    const subtaskStatus = pick(r, ["subtask_status"]);
    if (subtaskKey && !isCompleteStatus(subtaskStatus))
      g.openSubtaskKeys.add(subtaskKey);

    const linkType = (r.link_type || "").trim();
    const linkTypeUpper = linkType.toUpperCase();
    const linkedKey = r.linked_key;
    const linkedStatus = r.linked_status;
    const linkedTitle = r.linked_title || "";

    if (linkedKey && linkTypeUpper !== "NO LINKS") {
      if (!isCompleteStatus(linkedStatus)) g.openLinkedKeys.add(linkedKey);

      if (BLOCK_RE.test(linkType) && !isCompleteStatus(linkedStatus)) {
        g.blockerRows.push({
          parentKey: rk,
          linkedKey,
          linkedTitle,
          linkedStatus,
          linkType,
        });
      } else if (DEP_RE.test(linkType) && !isCompleteStatus(linkedStatus)) {
        g.depRows.push({
          parentKey: rk,
          linkedKey,
          linkedTitle,
          linkedStatus,
          linkType,
        });
      }

      if (GAP_RE.test(linkedTitle)) {
        if (isCompleteStatus(linkedStatus)) g.closedGapKeys.add(linkedKey);
        else g.openGapKeys.add(linkedKey);
      }
    }
  });

  const snapshots = [];
  for (const g of groups.values()) {
    const completion = calculateInitiativeCompletion(rows, g.key);
    const pending = calculatePendingPercent(completion);

    let health = "green";
    const blockers = g.blockerRows.length;
    const openGaps = g.openGapKeys.size;
    if (completion >= 80 && blockers === 0 && openGaps === 0) health = "green";
    else if (completion >= 50 && blockers <= 3 && openGaps <= 3) health = "yellow";
    else health = "red";

    snapshots.push({
      key: g.key,
      name: g.name || g.key,
      completion,
      pending,
      riCount: g.riKeys.size,
      openEpics: g.openEpicKeys.size,
      openStories: g.openStoryKeys.size,
      openTasks: g.openTaskKeys.size,
      openSubtasks: g.openSubtaskKeys.size,
      openLinked: g.openLinkedKeys.size,
      blockers,
      blockerRows: g.blockerRows,
      dependencies: g.depRows.length,
      depRows: g.depRows,
      openGaps,
      closedGaps: g.closedGapKeys.size,
      health,
    });
  }
  snapshots.sort((a, b) => a.completion - b.completion || a.name.localeCompare(b.name));
  return snapshots;
}

function HealthBadge({ health }) {
  const map = {
    green: { cls: "bg-emerald-100 text-emerald-800 border-emerald-200", label: "On Track", Icon: ShieldCheck },
    yellow: { cls: "bg-amber-100 text-amber-800 border-amber-200", label: "Watch", Icon: ShieldQuestion },
    red: { cls: "bg-rose-100 text-rose-800 border-rose-200", label: "At Risk", Icon: ShieldAlert },
  };
  const { cls, label, Icon } = map[health] || map.yellow;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function Progress({ value, tone = "emerald" }) {
  const colorMap = {
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    rose: "bg-rose-500",
  };
  let bar = colorMap.emerald;
  if (value < 25) bar = colorMap.rose;
  else if (value < 80) bar = colorMap.amber;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full ${bar} transition-all`} style={{ width: `${value}%` }} />
    </div>
  );
}

export function SourceBanner({ rows, uploadedFileName, loadedAt }) {
  const fmt = useMemo(() => {
    if (!loadedAt) return "—";
    try {
      return new Date(loadedAt).toLocaleString();
    } catch {
      return "—";
    }
  }, [loadedAt]);
  return (
    <Card className="rounded-2xl border-slate-200 bg-slate-50 shadow-sm">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3 text-xs text-slate-600">
        <div className="flex items-center gap-2">
          <Database className="h-3.5 w-3.5" />
          <span className="font-semibold text-slate-700">Data source:</span>{" "}
          {uploadedFileName ? (
            <span className="font-mono">{uploadedFileName}</span>
          ) : (
            <span>pasted CSV (in-browser, current session)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5" />
          <span className="font-semibold text-slate-700">Last loaded:</span> {fmt}
        </div>
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-3.5 w-3.5" />
          <span className="font-semibold text-slate-700">Records:</span> {rows.length}
        </div>
      </CardContent>
    </Card>
  );
}

export function ExecutivePortfolio({ rows }) {
  const snapshots = useMemo(() => computeInitiativeSnapshots(rows), [rows]);

  const totals = useMemo(() => {
    if (!snapshots.length) {
      return { count: 0, avgCompletion: 0, avgPending: 100, gaps: 0, blockers: 0, deps: 0, openLinked: 0 };
    }
    const avgCompletion = Math.round(
      snapshots.reduce((s, x) => s + x.completion, 0) / snapshots.length,
    );
    return {
      count: snapshots.length,
      avgCompletion,
      avgPending: 100 - avgCompletion,
      gaps: snapshots.reduce((s, x) => s + x.openGaps, 0),
      blockers: snapshots.reduce((s, x) => s + x.blockers, 0),
      deps: snapshots.reduce((s, x) => s + x.dependencies, 0),
      openLinked: snapshots.reduce((s, x) => s + x.openLinked, 0),
    };
  }, [snapshots]);

  const greens = snapshots.filter((s) => s.health === "green").length;
  const yellows = snapshots.filter((s) => s.health === "yellow").length;
  const reds = snapshots.filter((s) => s.health === "red").length;

  return (
    <div className="space-y-6">
      {/* TOP KPI ROW */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        <ExecKPI
          title="M&As"
          value={totals.count}
          sub={`${greens} on track · ${yellows} watch · ${reds} at risk`}
          tip="Distinct Initiatives in the loaded dataset, with their health breakdown (Green = ≥80% complete, no blockers / gaps · Yellow = ≥50% complete or limited blockers · Red = everything else)."
        />
        <ExecKPI
          title="Completion %"
          value={`${totals.avgCompletion}%`}
          tone={completionTone(totals.avgCompletion)}
          tip="Portfolio-average completion across all Initiatives. Each Initiative is the average of its RIs. Done / Closed / Resolved / Cancelled count as complete."
        />
        <ExecKPI
          title="Remaining %"
          value={`${totals.avgPending}%`}
          tone={totals.avgPending >= 50 ? "rose" : "amber"}
          tip="100 − Completion %. The share of M&A onboarding work still open across the portfolio."
        />
        <ExecKPI
          title="Open Gaps"
          value={totals.gaps}
          warn={totals.gaps > 0}
          tip="Linked issues whose title contains '[GAP]' AND whose status is not yet complete. These are team-flagged onboarding gaps."
        />
        <ExecKPI
          title="Open Blockers"
          value={totals.blockers}
          warn={totals.blockers > 0}
          tip="Linked issues with link_type containing 'block' (e.g. 'is blocked by', 'blocks') that are still active. Cannot complete the parent RI until these clear."
        />
        <ExecKPI
          title="Open Dependencies"
          value={totals.deps}
          tip="Active linked issues with link_type 'relates to', 'implements', 'is implemented by', 'depends on', etc. Tracks how interconnected the onboarding work is."
        />
      </div>

      {/* PORTFOLIO HEALTH TABLE */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="font-semibold">M&amp;A Portfolio Health</h2>
            <InfoTip title="One row per Initiative" side="right">
              The executive single-pane-of-glass: each Initiative with its rollup completion, what's still open at every level, blockers, dependencies, gaps, and a Green / Yellow / Red health verdict. Sorted by lowest completion first so risk floats to the top.
            </InfoTip>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="p-3">Initiative</th>
                  <th className="p-3">Health</th>
                  <th className="p-3">Completion</th>
                  <th className="p-3">Remaining</th>
                  <th className="p-3">Open Gaps</th>
                  <th className="p-3">Blockers</th>
                  <th className="p-3">Dependencies</th>
                  <th className="p-3">Open Linked</th>
                  <th className="p-3">RIs</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((s) => (
                  <tr key={s.key} className="border-t border-slate-100 align-top hover:bg-slate-50">
                    <td className="p-3">
                      <div className="font-semibold text-slate-900">{s.name}</div>
                      <div className="text-[11px] uppercase tracking-wide text-slate-500">
                        <JiraLink jKey={s.key} />
                      </div>
                    </td>
                    <td className="p-3"><HealthBadge health={s.health} /></td>
                    <td className="p-3 min-w-[140px]">
                      <div className="mb-1 text-sm font-semibold text-slate-900">{s.completion}%</div>
                      <Progress value={s.completion} />
                    </td>
                    <td className="p-3 font-semibold text-slate-700">{s.pending}%</td>
                    <td className="p-3">
                      <ScoreBadge value={s.openGaps} tone={s.openGaps > 0 ? "rose" : "slate"} />
                      {s.closedGaps > 0 && (
                        <div className="mt-0.5 text-[11px] text-slate-500">{s.closedGaps} closed</div>
                      )}
                    </td>
                    <td className="p-3"><ScoreBadge value={s.blockers} tone={s.blockers > 0 ? "rose" : "slate"} /></td>
                    <td className="p-3"><ScoreBadge value={s.dependencies} tone={s.dependencies > 0 ? "amber" : "slate"} /></td>
                    <td className="p-3"><ScoreBadge value={s.openLinked} tone="slate" /></td>
                    <td className="p-3"><ScoreBadge value={s.riCount} tone="slate" /></td>
                  </tr>
                ))}
                {snapshots.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-6 text-center text-sm text-slate-500">
                      No initiatives in the loaded CSV.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* REMAINING WORK BREAKDOWN */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <ListChecks className="h-4 w-4" />
              <h2 className="font-semibold">Remaining Work by Initiative</h2>
              <InfoTip title='Answers: "What is left?"' side="right">
                Counts of currently <b>open</b> work items per Initiative — distinct epics, stories, tasks, sub-tasks and linked issues whose status is not Done / Closed / Resolved / Cancelled.
              </InfoTip>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="p-2">Initiative</th>
                    <th className="p-2">Epics</th>
                    <th className="p-2">Stories</th>
                    <th className="p-2">Tasks</th>
                    <th className="p-2">Sub-tasks</th>
                    <th className="p-2">Linked</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((s) => (
                    <tr key={s.key} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="p-2 font-semibold">{s.name}</td>
                      <td className="p-2">{s.openEpics}</td>
                      <td className="p-2">{s.openStories}</td>
                      <td className="p-2">{s.openTasks}</td>
                      <td className="p-2">{s.openSubtasks}</td>
                      <td className="p-2">{s.openLinked}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-600" />
              <h2 className="font-semibold">Open Blockers & Dependencies</h2>
              <InfoTip title="Risk surface" side="right">
                <b>Blockers</b> = active linked issues with <code>link_type</code> containing 'block'. They prevent the parent RI from completing.
                <br />
                <b>Dependencies</b> = active linked issues with link types like 'relates to', 'implements', 'is implemented by', 'depends on'. They indicate cross-team coupling.
              </InfoTip>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="p-2">Initiative</th>
                    <th className="p-2">Blockers</th>
                    <th className="p-2">Dependencies</th>
                    <th className="p-2">Open Gaps</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((s) => (
                    <tr key={s.key} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="p-2 font-semibold">{s.name}</td>
                      <td className="p-2">
                        <ScoreBadge value={s.blockers} tone={s.blockers > 0 ? "rose" : "slate"} />
                      </td>
                      <td className="p-2">
                        <ScoreBadge value={s.dependencies} tone={s.dependencies > 0 ? "amber" : "slate"} />
                      </td>
                      <td className="p-2">
                        <ScoreBadge value={s.openGaps} tone={s.openGaps > 0 ? "rose" : "slate"} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* BLOCKER & DEPENDENCY DETAIL */}
      <Card className="rounded-2xl border-slate-200 shadow-sm">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            <h2 className="font-semibold">Top Open Blockers</h2>
            <InfoTip title="Active blockers" side="right">
              Every active linked issue with link_type matching 'block' across the portfolio. Use this to action what's actually holding RIs.
            </InfoTip>
          </div>
          <BlockerDepTable
            rows={snapshots.flatMap((s) =>
              s.blockerRows.map((b) => ({ ...b, initiative: s.name })),
            )}
            empty="No active blockers — nice."
          />
        </CardContent>
      </Card>
    </div>
  );
}

function BlockerDepTable({ rows, empty }) {
  if (!rows.length) {
    return <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">{empty}</div>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-600">
          <tr>
            <th className="p-2">Initiative</th>
            <th className="p-2">RI</th>
            <th className="p-2">Linked Issue</th>
            <th className="p-2">Status</th>
            <th className="p-2">Link Type</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="p-2 font-semibold">{r.initiative}</td>
              <td className="p-2 font-mono text-xs"><JiraLink jKey={r.parentKey} /></td>
              <td className="p-2">
                <div className="font-mono text-xs"><JiraLink jKey={r.linkedKey} /></div>
                <div className="text-slate-700">{r.linkedTitle}</div>
              </td>
              <td className="p-2"><Badge variant="outline">{r.linkedStatus || "Unknown"}</Badge></td>
              <td className="p-2"><Badge variant="destructive">{r.linkType}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function completionTone(pct) {
  if (pct >= 80) return "emerald";
  if (pct >= 50) return "amber";
  if (pct >= 25) return "orange";
  return "rose";
}

function ExecKPI({ title, value, sub, warn, tone, tip }) {
  const toneText =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "amber"
      ? "text-amber-700"
      : tone === "rose"
      ? "text-rose-700"
      : tone === "orange"
      ? "text-orange-700"
      : "text-slate-900";
  return (
    <Card className="rounded-2xl border-slate-200 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-1.5">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</div>
          {tip && <InfoTip title={title} side="left">{tip}</InfoTip>}
        </div>
        <div className={`mt-1 text-2xl font-bold ${toneText} ${warn ? "text-amber-700" : ""}`}>{value}</div>
        {sub && <div className="mt-1 text-[11px] text-slate-500">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function ScoreBadge({ value, tone }) {
  const map = {
    rose: "bg-rose-100 text-rose-800 border-rose-200",
    amber: "bg-amber-100 text-amber-800 border-amber-200",
    emerald: "bg-emerald-100 text-emerald-800 border-emerald-200",
    slate: "bg-slate-100 text-slate-700 border-slate-200",
  };
  return (
    <span className={`inline-flex min-w-[2rem] items-center justify-center rounded-md border px-2 py-0.5 text-xs font-semibold ${map[tone] || map.slate}`}>
      {value}
    </span>
  );
}

// ---------- Data Quality ----------

function computeDataQuality(rows) {
  const parentClosedChildActive = []; // {parentKey, parentTitle, childKey, childType, childStatus}
  const duplicateLinkMap = new Map(); // linkedKey -> Set(initiativeKey)
  const orphanLinks = []; // rows with linked_key but no roadmap_key
  const missingParents = []; // rows with no roadmap_key

  rows.forEach((r, idx) => {
    const rk = roadmapKeyOf(r);
    const parentStatus = pick(r, ["roadmap_status", "parent_status"]);
    const parentTitle = pick(r, ["roadmap_title", "parent_title"]);

    if (!rk) {
      missingParents.push({ row: idx + 1, raw: r });
    }

    if (rk && isCompleteStatus(parentStatus)) {
      const checks = [
        { k: pick(r, ["epic_key", "epic"]), s: pick(r, ["epic_status"]), t: "Epic" },
        { k: pick(r, ["story_key", "story", "issue_key"]), s: pick(r, ["story_status", "issue_status"]), t: "Story/Task" },
        { k: pick(r, ["subtask_key"]), s: pick(r, ["subtask_status"]), t: "Sub-task" },
      ];
      checks.forEach((c) => {
        if (c.k && c.s && !isCompleteStatus(c.s)) {
          parentClosedChildActive.push({
            parentKey: rk,
            parentTitle,
            parentStatus,
            childKey: c.k,
            childType: c.t,
            childStatus: c.s,
          });
        }
      });
      const lk = r.linked_key;
      const ltype = (r.link_type || "").toUpperCase().trim();
      if (lk && ltype !== "NO LINKS" && !isCompleteStatus(r.linked_status)) {
        parentClosedChildActive.push({
          parentKey: rk,
          parentTitle,
          parentStatus,
          childKey: lk,
          childType: "Linked",
          childStatus: r.linked_status,
        });
      }
    }

    const lk = r.linked_key;
    const ltype = (r.link_type || "").toUpperCase().trim();
    if (lk && ltype !== "NO LINKS") {
      if (!duplicateLinkMap.has(lk)) duplicateLinkMap.set(lk, new Set());
      duplicateLinkMap.get(lk).add(initiativeKeyOf(r));
      if (!rk) orphanLinks.push({ row: idx + 1, linkedKey: lk, linkedTitle: r.linked_title });
    }
  });

  const crossInitiativeLinks = [];
  for (const [lk, inits] of duplicateLinkMap.entries()) {
    if (inits.size > 1) {
      crossInitiativeLinks.push({ linkedKey: lk, initiatives: Array.from(inits) });
    }
  }

  return {
    parentClosedChildActive,
    crossInitiativeLinks,
    orphanLinks,
    missingParents,
  };
}

export function DataQuality({ rows }) {
  const dq = useMemo(() => computeDataQuality(rows), [rows]);

  const totalIssues =
    dq.parentClosedChildActive.length +
    dq.crossInitiativeLinks.length +
    dq.orphanLinks.length +
    dq.missingParents.length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <ExecKPI
          title="Status Mismatches"
          value={dq.parentClosedChildActive.length}
          warn={dq.parentClosedChildActive.length > 0}
          tip="Parent RI / Epic / Story is marked complete but a child item underneath it is still active. Means the team closed something prematurely or the child needs to be reclassified."
        />
        <ExecKPI
          title="Cross-Initiative Links"
          value={dq.crossInitiativeLinks.length}
          warn={dq.crossInitiativeLinks.length > 0}
          tip="A single linked Jira issue appears under more than one Initiative. Could be a shared dependency (acceptable) or a duplicate-mapping bug. Review and confirm."
        />
        <ExecKPI
          title="Orphan Links"
          value={dq.orphanLinks.length}
          warn={dq.orphanLinks.length > 0}
          tip="Rows that reference a linked issue but have no roadmap_key. These cannot be attributed to any RI and are not counted in any rollup."
        />
        <ExecKPI
          title="Missing Parents"
          value={dq.missingParents.length}
          warn={dq.missingParents.length > 0}
          tip="Rows with no roadmap_key / parent_key at all. They cannot be placed anywhere in the hierarchy."
        />
      </div>

      {totalIssues === 0 && (
        <Card className="rounded-2xl border-emerald-200 bg-emerald-50 shadow-sm">
          <CardContent className="flex items-center gap-3 p-4 text-emerald-800">
            <ShieldCheck className="h-5 w-5" />
            <div>
              <div className="font-semibold">No data quality issues detected.</div>
              <div className="text-xs">Hierarchy, statuses and linked records all look internally consistent.</div>
            </div>
          </CardContent>
        </Card>
      )}

      {dq.parentClosedChildActive.length > 0 && (
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h2 className="font-semibold">Closed Parent · Active Child</h2>
              <InfoTip title="What this flags" side="right">
                The parent RI / Epic / Story is in a complete status (Done / Closed / Resolved / Cancelled) while a child below it is still active. Either the parent was closed prematurely or the child needs to be re-statused.
              </InfoTip>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="p-2">Parent (RI)</th>
                    <th className="p-2">Parent Status</th>
                    <th className="p-2">Child Type</th>
                    <th className="p-2">Child</th>
                    <th className="p-2">Child Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dq.parentClosedChildActive.map((d, i) => (
                    <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="p-2">
                        <div className="font-mono text-xs"><JiraLink jKey={d.parentKey} /></div>
                        <div className="text-slate-700">{d.parentTitle}</div>
                      </td>
                      <td className="p-2"><Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 border">{d.parentStatus}</Badge></td>
                      <td className="p-2"><Badge variant="outline">{d.childType}</Badge></td>
                      <td className="p-2 font-mono text-xs"><JiraLink jKey={d.childKey} /></td>
                      <td className="p-2"><Badge className="bg-amber-100 text-amber-800 border-amber-200 border">{d.childStatus}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {dq.crossInitiativeLinks.length > 0 && (
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              <h2 className="font-semibold">Cross-Initiative Linked Issues</h2>
              <InfoTip title="Shared dependency or bug?" side="right">
                A linked Jira key that appears in two or more Initiatives. The completion rollup de-duplicates this so it doesn't get counted twice, but it's worth confirming the mapping is intentional.
              </InfoTip>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="p-2">Linked Key</th>
                    <th className="p-2">Appears under Initiatives</th>
                  </tr>
                </thead>
                <tbody>
                  {dq.crossInitiativeLinks.map((d) => (
                    <tr key={d.linkedKey} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="p-2 font-mono text-xs"><JiraLink jKey={d.linkedKey} /></td>
                      <td className="p-2">
                        {d.initiatives.map((i) => (
                          <Badge key={i} variant="outline" className="mr-1">{i}</Badge>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {(dq.orphanLinks.length > 0 || dq.missingParents.length > 0) && (
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h2 className="font-semibold">Unattached Rows</h2>
              <InfoTip title="Rows without a home" side="right">
                Rows missing a <code>roadmap_key</code> / <code>parent_key</code>. They are dropped from all rollups, charts and the hierarchy tree. Fix at the source CSV by populating the RI key.
              </InfoTip>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="p-2">CSV Row #</th>
                    <th className="p-2">Type</th>
                    <th className="p-2">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {dq.missingParents.map((d, i) => (
                    <tr key={`mp-${i}`} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="p-2 font-mono text-xs">{d.row}</td>
                      <td className="p-2"><Badge variant="outline">Missing Parent</Badge></td>
                      <td className="p-2 text-slate-700">No roadmap_key / parent_key on this row.</td>
                    </tr>
                  ))}
                  {dq.orphanLinks.map((d, i) => (
                    <tr key={`ol-${i}`} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="p-2 font-mono text-xs">{d.row}</td>
                      <td className="p-2"><Badge variant="outline">Orphan Link</Badge></td>
                      <td className="p-2 text-slate-700">
                        Linked <span className="font-mono text-xs"><JiraLink jKey={d.linkedKey} /></span>{" "}
                        {d.linkedTitle ? `· ${d.linkedTitle}` : ""} has no roadmap_key.
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
