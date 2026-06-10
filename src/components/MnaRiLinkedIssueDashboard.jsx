import React, { useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Upload,
  AlertTriangle,
  Link2,
  BarChart3,
  CircleCheck,
  CircleDashed,
  Download,
  ChevronRight,
  ChevronDown,
  FileSpreadsheet,
  FilePlus,
  X,
  TrendingUp,
  RefreshCw,
  Loader2,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LabelList,
} from "recharts";
import InfoTip from "@/components/InfoTip";
import JiraLink from "@/components/JiraLink";
import GleanAgent from "@/components/GleanAgent";
import {
  ExecutivePortfolio,
  DataQuality,
  SourceBanner,
} from "@/components/ExecutiveViews";
import {
  calculateInitiativeCompletion,
  calculateRICompletion,
  calculatePendingPercent,
} from "@/lib/completion";

const SAMPLE_CSV = `sbr_key,sbr_title,sbr_status,initiative_key,initiative_title,initiative_status,roadmap_key,roadmap_title,roadmap_status,epic_key,epic_title,epic_status,story_key,story_title,story_status,story_issuetype,subtask_key,subtask_title,subtask_status,subtask_issuetype,linked_key,linked_title,linked_status,linked_issuetype,link_direction,link_type
SBR-356,M&A Onboarding,Active,MNA-DAVO,DAVO,Active,MNAC-27,DAVO | Reliability Engineering Work (RI1),Closed,RELE-320389,DAVO - Reliability Engineering,Done,RELE-320389-1,Monitoring story,Done,Story,,,,,OBS-101,Observability dependency,Done,Task,outbound,relates to
SBR-356,M&A Onboarding,Active,MNA-DAVO,DAVO,Active,MNAC-11,DAVO | Shared Services Adoption (RI4),Elaboration,D30-9695,DAVO - Console Integration,To Do,D30-9695-1,Console migration story,In Progress,Task,D30-9695-1-1,Datastore prep subtask,To Do,Sub-task,IAM-8727,[GAP] DAVO IAM Assessment,To Do,Task,inbound,is blocked by
SBR-356,M&A Onboarding,Active,MNA-DAVO,DAVO,Active,MNAC-25,DAVO | AVATech Onboarding (RI2),Closed,,,,,,,,,,,,,,,NO LINKS
SBR-356,M&A Onboarding,Active,MNA-1099,Track1099,Active,MNAC-31,Track1099 | Reliability Engineering Work (RI1),Elaboration,AVA1099-9375,1099 RI1 Execution Epic,In Progress,AVA1099-9375-1,Execution story,Done,Story,,,,,CDC-140,1099 CDC Production,Production,Task,outbound,relates to
SBR-356,M&A Onboarding,Active,MNA-OOBJ,Oobj,Active,MNAC-53,Oobj | Reliability Engineering Work (RI1),New,RELEC-208,Oobj RELEC Active 1,Waiting for Production,,,,,,,,,,RELEC-164,Oobj RELEC Active 2,In Progress,Task,inbound,is blocked by`;

const HEADER_REQUIREMENT_GROUPS = [
  ["roadmap_key", "parent_key", "ri_key", "roadmap_item_key"],
  ["roadmap_title", "parent_title", "ri_title", "roadmap_item_title"],
];

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return [];
  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, i) => (row[h] = values[i] || ""));
    return row;
  });
}

function validateCSVHeaders(text) {
  const firstLine = (text.split(/\r?\n/)[0] || "").trim();
  if (!firstLine) return ["empty CSV"];
  const headers = parseCSVLine(firstLine).map((h) => h.toLowerCase().trim());
  const missing = [];
  HEADER_REQUIREMENT_GROUPS.forEach((group) => {
    if (!group.some((h) => headers.includes(h))) {
      missing.push(group.join(" / "));
    }
  });
  return missing;
}

function pick(row, keys) {
  for (const key of keys) if (row[key]) return row[key];
  return "";
}

function getMna(title = "") {
  return title.split("|")[0]?.trim() || "Unknown";
}

function getParentKey(row) {
  return pick(row, ["parent_key", "roadmap_key", "ri_key", "roadmap_item_key"]);
}

function getParentTitle(row) {
  return pick(row, [
    "parent_title",
    "roadmap_title",
    "ri_title",
    "roadmap_item_title",
  ]);
}

function getParentStatus(row) {
  return pick(row, [
    "parent_status",
    "roadmap_status",
    "ri_status",
    "roadmap_item_status",
  ]);
}

function getInitiative(row) {
  const title = pick(row, [
    "initiative_title",
    "initiative_name",
    "mna",
    "mna_name",
  ]);
  return title || getMna(getParentTitle(row));
}

function getInitiativeKey(row) {
  return (
    pick(row, ["initiative_key", "mna_key"]) ||
    getInitiative(row) ||
    "Unknown"
  );
}

function getRI(title = "") {
  const match = title.match(/\((RI\d+)\)/i);
  return match ? match[1].toUpperCase() : "Unknown";
}

function statusTone(status = "") {
  const s = status.toLowerCase();
  if (["done", "closed", "resolved"].some((x) => s.includes(x)))
    return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (["progress", "waiting", "blocked", "production"].some((x) => s.includes(x)))
    return "bg-amber-100 text-amber-800 border-amber-200";
  if (
    ["todo", "to do", "new", "elaboration", "ideation", "backlog", "open"].some(
      (x) => s.includes(x),
    )
  )
    return "bg-sky-100 text-sky-800 border-sky-200";
  if (s.includes("cancel")) return "bg-slate-100 text-slate-700 border-slate-200";
  return "bg-gray-100 text-gray-800 border-gray-200";
}

function completionTone(pct) {
  if (pct >= 80) return { bg: "bg-emerald-500", text: "text-emerald-700" };
  if (pct >= 50) return { bg: "bg-amber-500", text: "text-amber-700" };
  if (pct >= 25) return { bg: "bg-orange-500", text: "text-orange-700" };
  return { bg: "bg-rose-500", text: "text-rose-700" };
}

export default function MnaRiLinkedIssueDashboard() {
  const [csvText, setCsvText] = useState(SAMPLE_CSV);
  const [inputMode, setInputMode] = useState("paste");
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const [jiraJql, setJiraJql] = useState("issuekey = SBR-356 OR parent = SBR-356");
  const [jiraLoading, setJiraLoading] = useState(false);
  const [jiraError, setJiraError] = useState("");
  const [jiraLastPulled, setJiraLastPulled] = useState(0);

  const [search, setSearch] = useState("");
  const [selectedMnas, setSelectedMnas] = useState(() => new Set());
  const mnaFilter = "all"; // legacy var kept "all" - global chip filter is the real source of truth (filters rows upstream)
  const [riFilter, setRiFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [expanded, setExpanded] = useState({});
  const [viewMode, setViewMode] = useState("hierarchy");
  const [activeTab, setActiveTab] = useState("overview");
  const [loadedAt, setLoadedAt] = useState(() => Date.now());

  const rows = useMemo(() => parseCSV(csvText), [csvText]);

  const mnas = useMemo(() => {
    const set = new Set();
    rows.forEach((r) => {
      const n = getInitiative(r);
      if (n) set.add(n);
    });
    return Array.from(set).sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (selectedMnas.size === 0) return rows;
    return rows.filter((r) => selectedMnas.has(getInitiative(r)));
  }, [rows, selectedMnas]);

  const toggleMna = (name) => {
    setSelectedMnas((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };
  const selectAllMnas = () => setSelectedMnas(new Set());
  const isMnaActive = (m) => selectedMnas.size === 0 || selectedMnas.has(m);

  const parents = useMemo(() => {
    const map = new Map();
    filteredRows.forEach((r) => {
      const parentKey = getParentKey(r);
      const parentTitle = getParentTitle(r);
      if (!parentKey) return;
      if (!map.has(parentKey)) {
        map.set(parentKey, {
          parent_key: parentKey,
          parent_title: parentTitle,
          parent_status: getParentStatus(r),
          mna: getInitiative(r),
          initiativeKey: getInitiativeKey(r),
          ri: getRI(parentTitle),
          links: [],
        });
      }
      const linkType = (r.link_type || "").toUpperCase().trim();
      if (r.linked_key && linkType !== "NO LINKS") {
        map.get(parentKey).links.push(r);
      }
    });
    return Array.from(map.values());
  }, [filteredRows]);

  const hierarchy = useMemo(() => buildHierarchy(filteredRows), [filteredRows]);
  const toggle = (id) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  const expandAll = () => {
    const all = {};
    const walk = (node) => {
      all[node.id] = true;
      node.children.forEach(walk);
    };
    hierarchy.forEach(walk);
    setExpanded(all);
  };
  const collapseAll = () => setExpanded({});

  const ris = ["RI1", "RI2", "RI3", "RI4", "RI5"];

  // Initiative-level rollup (de-duped across RIs, per spec).
  const initiativeSummaries = useMemo(() => {
    const map = new Map();
    parents.forEach((p) => {
      const key = p.initiativeKey;
      if (!map.has(key)) {
        map.set(key, { key, name: p.mna, ris: [] });
      }
      map.get(key).ris.push(p);
    });
    return Array.from(map.values())
      .map((g) => {
        const completion = calculateInitiativeCompletion(filteredRows, g.key);
        return {
          ...g,
          completion,
          pending: calculatePendingPercent(completion),
          riCount: g.ris.length,
          linkedIssues: g.ris.reduce((sum, x) => sum + x.links.length, 0),
          zeroLinkRis: g.ris.filter((x) => x.links.length === 0).length,
        };
      })
      .sort((a, b) => a.completion - b.completion);
  }, [parents, filteredRows]);

  const initiativeCompletionAvg = useMemo(() => {
    if (!initiativeSummaries.length) return 0;
    return Math.round(
      initiativeSummaries.reduce((s, x) => s + x.completion, 0) /
        initiativeSummaries.length,
    );
  }, [initiativeSummaries]);

  const filteredParents = useMemo(() => {
    return parents.filter((p) => {
      const q = search.toLowerCase();
      const searchable = `${p.parent_key} ${p.parent_title} ${p.parent_status} ${p.links
        .map(
          (l) =>
            `${l.linked_key} ${l.linked_title} ${l.linked_status} ${l.link_type}`,
        )
        .join(" ")}`.toLowerCase();
      const matchesSearch = !q || searchable.includes(q);
      const matchesMna = mnaFilter === "all" || p.mna === mnaFilter;
      const matchesRi = riFilter === "all" || p.ri === riFilter;
      const hasBlocker = p.links.some((l) =>
        (l.link_type || "").toLowerCase().includes("block"),
      );
      const zeroLinks = p.links.length === 0;
      const hasGap = p.links.some((l) =>
        /\[gap\]|gap/i.test(l.linked_title || ""),
      );
      const matchesRisk =
        riskFilter === "all" ||
        (riskFilter === "blocked" && hasBlocker) ||
        (riskFilter === "zero" && zeroLinks) ||
        (riskFilter === "gap" && hasGap);
      return matchesSearch && matchesMna && matchesRi && matchesRisk;
    });
  }, [parents, search, mnaFilter, riFilter, riskFilter]);

  const metrics = useMemo(() => {
    const linkedRows = filteredRows.filter(
      (r) =>
        r.linked_key && (r.link_type || "").toUpperCase().trim() !== "NO LINKS",
    ).length;
    const zeroParents = parents.filter((p) => p.links.length === 0).length;
    const blockers = filteredRows.filter((r) =>
      (r.link_type || "").toLowerCase().includes("block"),
    ).length;
    const gaps = filteredRows.filter((r) =>
      /\[gap\]|gap/i.test(r.linked_title || ""),
    ).length;
    const visibleMnas =
      selectedMnas.size === 0 ? mnas.length : selectedMnas.size;
    return {
      parents: parents.length,
      linkedRows,
      zeroParents,
      blockers,
      gaps,
      mnas: visibleMnas,
    };
  }, [filteredRows, parents, mnas, selectedMnas]);

  const mnaChart = useMemo(
    () =>
      initiativeSummaries.map((g) => ({
        name: g.name,
        completion: g.completion,
        pending: g.pending,
        linked: g.linkedIssues,
      })),
    [initiativeSummaries],
  );

  const riChart = useMemo(() => {
    return ris.map((ri) => {
      const p = parents.filter((x) => x.ri === ri);
      const completionList = p
        .map((x) => calculateRICompletion(filteredRows, x.parent_key))
        .filter((v) => !Number.isNaN(v));
      const avg = completionList.length
        ? Math.round(
            completionList.reduce((a, b) => a + b, 0) / completionList.length,
          )
        : 0;
      return {
        name: ri,
        completion: avg,
        linked: p.reduce((sum, x) => sum + x.links.length, 0),
        zero: p.filter((x) => x.links.length === 0).length,
      };
    });
  }, [parents, filteredRows]);

  const coverageData = [
    { name: "Parents with links", value: metrics.parents - metrics.zeroParents },
    { name: "Parents without links", value: metrics.zeroParents },
  ];

  const PIE_COLORS = ["#10b981", "#f59e0b"];

  const exportFiltered = () => {
    const header =
      "parent_key,parent_title,parent_status,linked_key,linked_title,linked_status,link_type";
    const out = [header];
    filteredParents.forEach((p) => {
      if (p.links.length === 0) {
        out.push(
          [p.parent_key, p.parent_title, p.parent_status, "", "", "", ""]
            .map(csvEscape)
            .join(","),
        );
      } else {
        p.links.forEach((l) =>
          out.push(
            [
              l.parent_key || p.parent_key,
              l.parent_title || p.parent_title,
              l.parent_status || p.parent_status,
              l.linked_key,
              l.linked_title,
              l.linked_status,
              l.link_type,
            ]
              .map(csvEscape)
              .join(","),
          ),
        );
      }
    });
    const blob = new Blob([out.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mna-ri-linked-issues-filtered.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  function csvEscape(value) {
    const s = String(value || "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function loadFromText(text, fileName = "") {
    const missing = validateCSVHeaders(text);
    if (missing.length) {
      setUploadError(`Missing required header(s): ${missing.join("; ")}`);
      return false;
    }
    setUploadError("");
    setCsvText(text);
    setUploadedFileName(fileName);
    setLoadedAt(Date.now());
    return true;
  }

  function handleFile(file) {
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      setUploadError("Only .csv files are accepted.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setUploadError("Could not read the file.");
    reader.onload = (e) => {
      const text = String(e.target?.result || "");
      loadFromText(text, file.name);
    };
    reader.readAsText(file);
  }

  function clearData() {
    setCsvText("");
    setUploadedFileName("");
    setUploadError("");
    setLoadedAt(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function resetToSample() {
    setCsvText(SAMPLE_CSV);
    setUploadedFileName("");
    setUploadError("");
    setLoadedAt(Date.now());
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function pullFromJira() {
    setJiraLoading(true);
    setJiraError("");
    try {
      const resp = await fetch("/api/jira-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jql: jiraJql }),
      });
      if (!resp.ok) {
        let msg = `HTTP ${resp.status}`;
        try {
          const j = await resp.json();
          if (j.error) msg = j.error;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const text = await resp.text();
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length <= 1) {
        throw new Error("Jira returned 0 issues for that JQL.");
      }
      setCsvText(text);
      setUploadedFileName(`Jira live: ${jiraJql.slice(0, 60)}${jiraJql.length > 60 ? "…" : ""}`);
      setUploadError("");
      setLoadedAt(Date.now());
      setJiraLastPulled(Date.now());
    } catch (err) {
      setJiraError(err.message || String(err));
    } finally {
      setJiraLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white">
              <BarChart3 className="h-3.5 w-3.5" /> Leadership View
            </div>
            <h1 className="text-3xl font-bold tracking-tight">
              M&amp;A Jira Hierarchy + Linked-Issue Dashboard
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              SBR-356 → Initiative → Roadmap Item → Epic → Story/Task/Sub-task → linked Jira. Paste or upload your CSV.
            </p>
          </div>
          <Button onClick={exportFiltered} className="gap-2 rounded-2xl shadow-sm">
            <Download className="h-4 w-4" /> Export Filtered CSV
          </Button>
        </div>

        <div className="flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
          {[
            { id: "overview", label: "Overview" },
            { id: "executive", label: "Executive Portfolio" },
            { id: "quality", label: "Data Quality" },
            { id: "live", label: "Live Pull" },
          ].map((t) => (
            <Button
              key={t.id}
              variant={activeTab === t.id ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab(t.id)}
              className="rounded-xl"
            >
              {t.label}
            </Button>
          ))}
        </div>

        {mnas.length > 0 && (
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardContent className="flex flex-wrap items-center gap-2 p-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Filter by M&A
              </span>
              {mnas.map((m) => {
                const active = isMnaActive(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggleMna(m)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                      active
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                    aria-pressed={active}
                  >
                    {m}
                  </button>
                );
              })}
              <Button size="sm" variant="ghost" onClick={selectAllMnas} className="h-7 px-2 text-xs">
                Show all
              </Button>
              <span className="ml-auto text-xs text-slate-500">
                {selectedMnas.size === 0
                  ? `Showing all ${mnas.length} M&As`
                  : `Showing ${selectedMnas.size} of ${mnas.length} M&As`}
              </span>
              <InfoTip title="Global M&A filter" side="left">
                Click M&A chips to focus the entire dashboard - <b>every chart, KPI and table on every tab</b> updates instantly. Click again to deselect. <b>Show all</b> clears the filter. The footer record count always reflects the full dataset.
              </InfoTip>
            </CardContent>
          </Card>
        )}

        {activeTab === "overview" && (<>
        {/* CSV INPUT CARD: Paste / Upload tabs */}
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 font-semibold">
                <FileSpreadsheet className="h-4 w-4" /> Data Source
                <InfoTip title="How to load data" side="right">
                  Two ways to load Jira data: <b>Paste</b> exported CSV text, or <b>Upload</b> a <code>.csv</code> file. We validate that at least <code>roadmap_key</code> (or <code>parent_key</code>) and <code>roadmap_title</code> (or <code>parent_title</code>) columns exist. All other columns are optional and used when present.
                </InfoTip>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={inputMode === "paste" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setInputMode("paste")}
                  className="gap-2"
                >
                  <FileSpreadsheet className="h-4 w-4" /> Paste
                </Button>
                <Button
                  variant={inputMode === "upload" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setInputMode("upload")}
                  className="gap-2"
                >
                  <Upload className="h-4 w-4" /> Upload CSV
                </Button>
                <Button
                  variant={inputMode === "jira" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setInputMode("jira")}
                  className="gap-2"
                >
                  <RefreshCw className="h-4 w-4" /> Live Jira
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetToSample}
                  className="gap-2 text-slate-600"
                >
                  Reset to sample
                </Button>
              </div>
            </div>

            {inputMode === "paste" && (
              <Textarea
                value={csvText}
                onChange={(e) => {
                  setCsvText(e.target.value);
                  setUploadedFileName("");
                  setUploadError("");
                }}
                className="min-h-40 font-mono text-xs"
                placeholder="Paste CSV. Supported headers: sbr_*, initiative_*, roadmap_*, epic_*, story_*, subtask_*, source_issue_*, linked_*, link_direction, link_type. Legacy parent_* CSV also works."
              />
            )}
            {inputMode === "jira" && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    JQL
                  </label>
                  <InfoTip title="Live Jira pull" side="right">
                    Hits <code>/api/jira-export</code> (server-side, basic-auth via Vercel env vars). The function runs your JQL against Avalara Jira and returns CSV in this dashboard's schema. Each issue produces one row per linked issue (or a single <code>NO LINKS</code> row).
                  </InfoTip>
                </div>
                <Input
                  value={jiraJql}
                  onChange={(e) => setJiraJql(e.target.value)}
                  placeholder='e.g. issuekey = SBR-356 OR parent = SBR-356'
                  className="font-mono text-xs"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    onClick={pullFromJira}
                    disabled={jiraLoading || !jiraJql.trim()}
                    className="gap-2"
                  >
                    {jiraLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    {jiraLoading ? "Pulling..." : "Pull from Jira"}
                  </Button>
                  {jiraLastPulled > 0 && !jiraError && (
                    <span className="text-xs text-slate-500">
                      Last pulled {new Date(jiraLastPulled).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                {jiraError && (
                  <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <div>
                      <div className="font-semibold">Jira pull failed</div>
                      <div className="text-xs">{jiraError}</div>
                      <div className="mt-1 text-[11px] text-rose-700">
                        Ensure <code>JIRA_BASE_URL</code>, <code>JIRA_EMAIL</code>, <code>JIRA_API_TOKEN</code> are set in Vercel env vars and the JQL is valid.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            {inputMode === "upload" && (
              <div className="space-y-3">
                <label
                  htmlFor="csv-upload-input"
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragOver(true);
                  }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragOver(false);
                    const f = e.dataTransfer.files?.[0];
                    handleFile(f);
                  }}
                  className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition ${
                    isDragOver
                      ? "border-sky-500 bg-sky-50"
                      : "border-slate-300 hover:border-slate-400 hover:bg-slate-50"
                  }`}
                >
                  <FilePlus className="h-7 w-7 text-slate-500" />
                  <div className="text-sm font-semibold text-slate-800">
                    Drop a <span className="font-mono">.csv</span> here or click to browse
                  </div>
                  <div className="text-xs text-slate-500">
                    Parsed entirely in your browser — no upload to any server.
                  </div>
                  <input
                    id="csv-upload-input"
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => handleFile(e.target.files?.[0])}
                  />
                </label>
                {uploadedFileName && !uploadError && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="h-4 w-4" />
                      Loaded: <span className="font-mono">{uploadedFileName}</span>
                      <span className="text-emerald-700">· {rows.length} row(s)</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearData}
                      className="gap-1 text-emerald-900 hover:bg-emerald-100"
                    >
                      <X className="h-4 w-4" /> Clear / Upload another
                    </Button>
                  </div>
                )}
                {uploadError && (
                  <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <div>
                      <div className="font-semibold">Could not load CSV</div>
                      <div className="text-xs">{uploadError}</div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* METRICS */}
        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
          <Metric
            title="M&As"
            value={metrics.mnas}
            icon={<CircleCheck />}
            tip="Distinct Initiatives (M&A acquisitions). Counted from initiative_title / initiative_key / mna in the CSV."
          />
          <Metric
            title="RI / Roadmap Items"
            value={metrics.parents}
            icon={<CircleDashed />}
            tip="Total Roadmap Items (RIs) loaded. One per unique roadmap_key / parent_key. Each RI is a parent of Epics, Stories, Sub-tasks and linked Jira records."
          />
          <Metric
            title="Linked Issues"
            value={metrics.linkedRows}
            icon={<Link2 />}
            tip="CSV rows with a populated linked_key (rows marked link_type = NO LINKS are excluded). Use this to gauge external dependency volume."
          />
          <Metric
            title="No-Link Parents"
            value={metrics.zeroParents}
            icon={<AlertTriangle />}
            warn
            tip="Roadmap Items that have no linked Jira issues. These are gaps in dependency mapping — leadership should ask the team why an RI has no downstream tracking."
          />
          <Metric
            title="Blockers"
            value={metrics.blockers}
            icon={<AlertTriangle />}
            warn
            tip="Linked rows whose link_type contains 'block' (e.g. 'is blocked by'). Active risk: these have to clear before the parent RI can complete."
          />
          <Metric
            title="Gaps"
            value={metrics.gaps}
            icon={<Search />}
            tip="Linked rows whose title contains '[GAP]' (or the word 'gap'). These are explicit, team-flagged gaps in M&A onboarding coverage."
          />
        </div>

        {/* INITIATIVE COMPLETION OVERVIEW */}
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">M&amp;A Onboarding Progress</h2>
                  <InfoTip title="How completion is calculated" side="right">
                    Each Initiative's completion is the average of its Roadmap Items (RIs). An RI's completion is the % of its child Jira records ({" "}
                    <code>epic_key</code>, <code>story_key</code>, <code>subtask_key</code>, <code>source_issue_key</code>, plus linked records) whose status is Done / Closed / Resolved / Cancelled. RIs with no children fall back to their own status. Shared linked issues are de-duplicated within an Initiative. <b>Pending = 100 − Completion.</b>
                  </InfoTip>
                </div>
                <p className="text-xs text-slate-500">
                  Portfolio average: <b>{initiativeCompletionAvg}%</b> complete · <b>{100 - initiativeCompletionAvg}%</b> pending
                </p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white">
                <TrendingUp className="h-3.5 w-3.5" /> Rollup from Jira status
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {initiativeSummaries.map((g) => (
                <InitiativeCard key={g.key} g={g} />
              ))}
              {initiativeSummaries.length === 0 && (
                <div className="col-span-full rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
                  No Initiative data in the current CSV.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* CHARTS ROW */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="rounded-2xl border-slate-200 shadow-sm lg:col-span-2">
            <CardContent className="p-4">
              <div className="mb-4 flex items-center gap-2">
                <h2 className="font-semibold">Completion vs Pending by M&amp;A</h2>
                <InfoTip title="What this shows" side="right">
                  Stacked bar of <b>Completion %</b> (green) vs <b>Pending %</b> (amber) for each Initiative.
                  Driven by Jira statuses of epics, stories, sub-tasks and linked records under each RI.
                  Use this to see which acquisitions still have material onboarding work.
                </InfoTip>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={mnaChart}
                    margin={{ top: 8, right: 12, left: 0, bottom: 48 }}
                  >
                    <XAxis
                      dataKey="name"
                      angle={-25}
                      textAnchor="end"
                      interval={0}
                      height={70}
                      fontSize={11}
                    />
                    <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      formatter={(value, name) =>
                        name === "completion" || name === "pending"
                          ? [`${value}%`, name === "completion" ? "Completion" : "Pending"]
                          : [value, name]
                      }
                    />
                    <Bar
                      dataKey="completion"
                      stackId="pct"
                      name="completion"
                      fill="#10b981"
                      radius={[0, 0, 0, 0]}
                    >
                      <LabelList
                        dataKey="completion"
                        position="insideTop"
                        formatter={(v) => (v >= 12 ? `${v}%` : "")}
                        fill="#ecfdf5"
                        fontSize={11}
                      />
                    </Bar>
                    <Bar
                      dataKey="pending"
                      stackId="pct"
                      name="pending"
                      fill="#f59e0b"
                      radius={[8, 8, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardContent className="p-4">
              <div className="mb-4 flex items-center gap-2">
                <h2 className="font-semibold">Parent Coverage</h2>
                <InfoTip title="What this shows" side="left">
                  Share of RIs that have at least one linked Jira issue vs RIs with none.
                  Low coverage means dependencies aren't being mapped — a risk indicator for leadership.
                </InfoTip>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={coverageData}
                      dataKey="value"
                      nameKey="name"
                      outerRadius={90}
                      label
                    >
                      {coverageData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="mb-4 flex items-center gap-2">
              <h2 className="font-semibold">RI Coverage View</h2>
              <InfoTip title="What this shows" side="right">
                For each RI bucket (RI1–RI5, parsed from the <code>(RIn)</code> token in roadmap titles), the average completion across RIs in that bucket, plus how many linked issues and how many zero-link parents fall in it. Use it to compare onboarding workstreams across acquisitions.
              </InfoTip>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={riChart}>
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar
                    dataKey="completion"
                    name="Avg Completion %"
                    radius={[8, 8, 0, 0]}
                    fill="#10b981"
                  />
                  <Bar
                    dataKey="linked"
                    name="Linked Issues"
                    radius={[8, 8, 0, 0]}
                    fill="#0ea5e9"
                  />
                  <Bar
                    dataKey="zero"
                    name="Zero-Link Parents"
                    radius={[8, 8, 0, 0]}
                    fill="#f59e0b"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2">
                <div>
                  <h2 className="font-semibold">Detailed View</h2>
                  <p className="text-xs text-slate-500">
                    Switch between expandable hierarchy and flat linked-issue table.
                  </p>
                </div>
                <InfoTip title="How to read this" side="right">
                  <b>Hierarchy</b>: SBR → Initiative → Roadmap Item → Epic → Story/Task → Sub-task → linked issues. Expand any node to see direct dependencies and statuses.
                  <br />
                  <b>Flat Links</b>: every RI-to-linked-issue pairing as a single table row, easy to scan for blockers and gaps.
                  Filters below apply to both views.
                </InfoTip>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={viewMode === "hierarchy" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("hierarchy")}
                  className="gap-2"
                >
                  <ChevronRight className="h-4 w-4" /> Hierarchy
                </Button>
                <Button
                  variant={viewMode === "flat" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("flat")}
                >
                  Flat Links
                </Button>
                {viewMode === "hierarchy" && (
                  <>
                    <Button variant="outline" size="sm" onClick={expandAll}>
                      Expand All
                    </Button>
                    <Button variant="outline" size="sm" onClick={collapseAll}>
                      Collapse All
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="relative md:col-span-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search key/title/status"
                  className="pl-9"
                />
              </div>
              <Select value={riFilter} onValueChange={setRiFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="RI" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All RIs</SelectItem>
                  {ris.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={riskFilter} onValueChange={setRiskFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Risk" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Records</SelectItem>
                  <SelectItem value="blocked">Blockers Only</SelectItem>
                  <SelectItem value="gap">Gaps Only</SelectItem>
                  <SelectItem value="zero">No Linked Issues</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {viewMode === "hierarchy" ? (
              <HierarchyView
                hierarchy={hierarchy}
                expanded={expanded}
                toggle={toggle}
                search={search}
                mnaFilter={mnaFilter}
                riFilter={riFilter}
                riskFilter={riskFilter}
                rows={filteredRows}
              />
            ) : (
              <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="p-3">M&A / RI Parent</th>
                      <th className="p-3">Parent Status</th>
                      <th className="p-3">Linked Issue</th>
                      <th className="p-3">Linked Status</th>
                      <th className="p-3">Link Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredParents.map((p) => {
                      if (p.links.length === 0)
                        return (
                          <ParentRow key={p.parent_key} p={p} link={null} />
                        );
                      return p.links.map((l, idx) => (
                        <ParentRow
                          key={`${p.parent_key}-${l.linked_key}-${idx}`}
                          p={p}
                          link={l}
                          showParent={idx === 0}
                          rowSpan={p.links.length}
                        />
                      ));
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        </>)}

        {activeTab === "executive" && <ExecutivePortfolio rows={filteredRows} />}
        {activeTab === "quality" && <DataQuality rows={filteredRows} />}
        {activeTab === "live" && <GleanAgent />}

        <SourceBanner rows={rows} uploadedFileName={uploadedFileName} loadedAt={loadedAt} />
      </div>
    </div>
  );
}

function InitiativeCard({ g }) {
  const tone = completionTone(g.completion);
  return (
    <div className="relative rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="text-base font-semibold text-slate-900">{g.name}</div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500">
            {g.key} · {g.riCount} RI{g.riCount === 1 ? "" : "s"}
          </div>
        </div>
        <InfoTip title={`${g.name} rollup`} side="left">
          Completion is the avg of this Initiative's {g.riCount} RI{g.riCount === 1 ? "" : "s"}. Each RI is scored from its child epics / stories / sub-tasks plus de-duped linked issues — Done/Closed/Resolved/Cancelled count as complete. Pending = 100 − Completion.
        </InfoTip>
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`text-3xl font-bold ${tone.text}`}>{g.completion}%</span>
        <span className="text-xs text-slate-500">complete</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full ${tone.bg} transition-all`}
          style={{ width: `${g.completion}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="text-slate-600">
          Pending: <b className="text-slate-900">{g.pending}%</b>
        </span>
        <span className="text-slate-500">
          {g.linkedIssues} linked · {g.zeroLinkRis} zero-link
        </span>
      </div>
    </div>
  );
}

function buildHierarchy(rows) {
  const sbrs = new Map();
  const SYNTHETIC = "__no-sbr__";
  rows.forEach((r, idx) => {
    const sbrKey = pick(r, ["sbr_key"]);
    const sbrTitle = pick(r, ["sbr_title"]);
    const sbrStatus = pick(r, ["sbr_status"]);

    const initiativeKey =
      pick(r, ["initiative_key", "mna_key"]) ||
      getInitiative(r) ||
      "Unknown Initiative";
    const initiativeTitle = getInitiative(r) || initiativeKey;
    const initiativeStatus = pick(r, ["initiative_status", "mna_status"]);

    const roadmapKey = getParentKey(r) || `roadmap-${idx}`;
    const roadmapTitle = getParentTitle(r) || roadmapKey;
    const roadmapStatus = getParentStatus(r);

    const epicKey = pick(r, ["epic_key", "epic"]);
    const epicTitle = pick(r, ["epic_title", "epic_summary"]);
    const epicStatus = pick(r, ["epic_status"]);

    const storyKey = pick(r, ["story_key", "story", "issue_key"]);
    const storyTitle = pick(r, ["story_title", "story_summary", "issue_title"]);
    const storyStatus = pick(r, ["story_status", "issue_status"]);
    const storyType = pick(r, ["story_issuetype"]) || "Story";

    const subtaskKey = pick(r, ["subtask_key"]);
    const subtaskTitle = pick(r, ["subtask_title"]);
    const subtaskStatus = pick(r, ["subtask_status"]);
    const subtaskType = pick(r, ["subtask_issuetype"]) || "Sub-task";

    const topKey = sbrKey || SYNTHETIC;
    if (!sbrs.has(topKey)) {
      sbrs.set(
        topKey,
        sbrKey
          ? makeNode("sbr", sbrKey, sbrTitle || sbrKey, sbrStatus)
          : makeNode("group", SYNTHETIC, "Initiatives", ""),
      );
    }
    const top = sbrs.get(topKey);
    const initiative = getOrCreateChild(
      top,
      "initiative",
      initiativeKey,
      initiativeTitle,
      initiativeStatus,
    );
    const roadmap = getOrCreateChild(
      initiative,
      "roadmap",
      roadmapKey,
      roadmapTitle,
      roadmapStatus,
    );
    let attachNode = roadmap;
    if (epicKey)
      attachNode = getOrCreateChild(
        attachNode,
        "epic",
        epicKey,
        epicTitle || epicKey,
        epicStatus,
      );
    if (storyKey)
      attachNode = getOrCreateChild(
        attachNode,
        storyType.toLowerCase().includes("task") &&
          !storyType.toLowerCase().includes("sub")
          ? "task"
          : "story",
        storyKey,
        storyTitle || storyKey,
        storyStatus,
        storyType,
      );
    if (subtaskKey)
      attachNode = getOrCreateChild(
        attachNode,
        "subtask",
        subtaskKey,
        subtaskTitle || subtaskKey,
        subtaskStatus,
        subtaskType,
      );

    const linkType = (r.link_type || "").toUpperCase().trim();
    if (r.linked_key && linkType !== "NO LINKS") attachNode.links.push(r);
  });

  // If there was no real SBR anywhere, return flat list of Initiatives.
  if (sbrs.size === 1 && sbrs.has(SYNTHETIC)) {
    return sbrs.get(SYNTHETIC).children;
  }
  return Array.from(sbrs.values());
}

function makeNode(type, key, title, status, issuetype) {
  return {
    id: `${type}:${key}`,
    type,
    key,
    title,
    status,
    issuetype: issuetype || "",
    children: [],
    links: [],
  };
}

function getOrCreateChild(parent, type, key, title, status, issuetype) {
  let node = parent.children.find((c) => c.type === type && c.key === key);
  if (!node) {
    node = makeNode(type, key, title, status, issuetype);
    parent.children.push(node);
  }
  return node;
}

function collectLinks(node) {
  return [...node.links, ...node.children.flatMap(collectLinks)];
}

function nodeHasRisk(node, riskFilter) {
  const allLinks = collectLinks(node);
  if (riskFilter === "all") return true;
  if (riskFilter === "blocked")
    return allLinks.some((l) =>
      (l.link_type || "").toLowerCase().includes("block"),
    );
  if (riskFilter === "gap")
    return allLinks.some((l) => /\[gap\]|gap/i.test(l.linked_title || ""));
  if (riskFilter === "zero") return allLinks.length === 0;
  return true;
}

function nodeMatches(node, search, mnaFilter, riFilter, riskFilter) {
  const q = search.toLowerCase();
  const text =
    `${node.key} ${node.title} ${node.status} ${collectLinks(node)
      .map(
        (l) =>
          `${l.linked_key} ${l.linked_title} ${l.linked_status} ${l.link_type}`,
      )
      .join(" ")}`.toLowerCase();
  const searchOk = !q || text.includes(q);
  const mnaOk =
    mnaFilter === "all" ||
    node.title === mnaFilter ||
    text.includes(mnaFilter.toLowerCase());
  const riOk = riFilter === "all" || text.includes(riFilter.toLowerCase());
  return searchOk && mnaOk && riOk && nodeHasRisk(node, riskFilter);
}

const TYPE_LABEL = {
  sbr: "SBR",
  group: "Group",
  initiative: "Initiative",
  roadmap: "Roadmap Item",
  epic: "Epic",
  story: "Story",
  task: "Task",
  subtask: "Sub-task",
};

function HierarchyView({
  hierarchy,
  expanded,
  toggle,
  search,
  mnaFilter,
  riFilter,
  riskFilter,
  rows,
}) {
  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
      {hierarchy
        .filter((n) => nodeMatches(n, search, mnaFilter, riFilter, riskFilter))
        .map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            depth={0}
            expanded={expanded}
            toggle={toggle}
            search={search}
            mnaFilter={mnaFilter}
            riFilter={riFilter}
            riskFilter={riskFilter}
            rows={rows}
          />
        ))}
    </div>
  );
}

function TreeNode({
  node,
  depth,
  expanded,
  toggle,
  search,
  mnaFilter,
  riFilter,
  riskFilter,
  rows,
}) {
  const isOpen = !!expanded[node.id];
  const visibleChildren = node.children.filter((n) =>
    nodeMatches(n, search, mnaFilter, riFilter, riskFilter),
  );
  const links = collectLinks(node);
  const directLinks = node.links;
  const hasKids = visibleChildren.length > 0 || directLinks.length > 0;
  const typeLabel =
    node.issuetype || TYPE_LABEL[node.type] || node.type;

  let completion = null;
  if (node.type === "initiative") {
    completion = calculateInitiativeCompletion(rows, node.key);
  } else if (node.type === "roadmap") {
    completion = calculateRICompletion(rows, node.key);
  }

  return (
    <div>
      <div
        className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50"
        style={{ paddingLeft: `${depth * 24 + 8}px` }}
      >
        <button
          onClick={() => toggle(node.id)}
          className="rounded p-1 hover:bg-slate-100"
          disabled={!hasKids}
        >
          {hasKids ? (
            isOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )
          ) : (
            <span className="inline-block h-4 w-4" />
          )}
        </button>
        <Badge variant="outline">{typeLabel}</Badge>
        <div className="min-w-28 font-semibold">
          <JiraLink jKey={node.key} />
        </div>
        <div className="flex-1 text-slate-700">{node.title}</div>
        {node.status && (
          <Badge className={`${statusTone(node.status)} border`}>
            {node.status}
          </Badge>
        )}
        {completion !== null && (
          <Badge className={`${completionTone(completion).bg} text-white border-transparent`}>
            {completion}%
          </Badge>
        )}
        <Badge variant={links.length ? "secondary" : "outline"}>
          {links.length} links
        </Badge>
        {links.some((l) =>
          (l.link_type || "").toLowerCase().includes("block"),
        ) && <Badge variant="destructive">blocked</Badge>}
      </div>
      {isOpen && directLinks.length > 0 && (
        <div className="ml-12 mr-2 overflow-hidden rounded-xl border border-slate-100 bg-slate-50">
          {directLinks.map((l, idx) => (
            <div
              key={`${node.id}-${l.linked_key}-${idx}`}
              className="grid grid-cols-12 gap-2 border-t border-slate-100 p-2 text-xs first:border-t-0"
            >
              <div className="col-span-2 font-semibold">
                <JiraLink jKey={l.linked_key} />
              </div>
              <div className="col-span-6">{l.linked_title}</div>
              <div className="col-span-2">
                <Badge className={`${statusTone(l.linked_status)} border`}>
                  {l.linked_status || "Unknown"}
                </Badge>
              </div>
              <div className="col-span-2">
                <Badge
                  variant={
                    (l.link_type || "").toLowerCase().includes("block")
                      ? "destructive"
                      : "secondary"
                  }
                >
                  {l.link_type}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}
      {isOpen &&
        visibleChildren.map((child) => (
          <TreeNode
            key={child.id}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
            search={search}
            mnaFilter={mnaFilter}
            riFilter={riFilter}
            riskFilter={riskFilter}
            rows={rows}
          />
        ))}
    </div>
  );
}

function Metric({ title, value, icon, warn, tip }) {
  return (
    <Card className="rounded-2xl border-slate-200 shadow-sm">
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <div className="flex items-center gap-1.5">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {title}
            </div>
            {tip && (
              <InfoTip title={title} side="right">
                {tip}
              </InfoTip>
            )}
          </div>
          <div className="mt-1 text-2xl font-bold">{value}</div>
        </div>
        <div
          className={`rounded-2xl p-2 ${
            warn ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700"
          }`}
        >
          {React.cloneElement(icon, { className: "h-5 w-5" })}
        </div>
      </CardContent>
    </Card>
  );
}

function ParentRow({ p, link, showParent = true, rowSpan = 1 }) {
  return (
    <tr className="border-t border-slate-100 align-top hover:bg-slate-50">
      {showParent && (
        <td className="p-3" rowSpan={rowSpan}>
          <div className="font-semibold text-slate-900">
            <JiraLink jKey={p.parent_key} />
          </div>
          <div className="max-w-md text-slate-700">{p.parent_title}</div>
          <div className="mt-1 flex gap-1">
            <Badge variant="outline">{p.mna}</Badge>
            <Badge variant="outline">{p.ri}</Badge>
          </div>
        </td>
      )}
      {showParent && (
        <td className="p-3" rowSpan={rowSpan}>
          <Badge className={`${statusTone(p.parent_status)} border`}>
            {p.parent_status || "Unknown"}
          </Badge>
        </td>
      )}
      <td className="p-3">
        {link ? (
          <>
            <div className="font-semibold">
              <JiraLink jKey={link.linked_key} />
            </div>
            <div className="max-w-xl text-slate-700">{link.linked_title}</div>
          </>
        ) : (
          <span className="font-medium text-amber-700">No linked issues</span>
        )}
      </td>
      <td className="p-3">
        {link ? (
          <Badge className={`${statusTone(link.linked_status)} border`}>
            {link.linked_status || "Unknown"}
          </Badge>
        ) : (
          ""
        )}
      </td>
      <td className="p-3">
        {link ? (
          <Badge
            variant={
              (link.link_type || "").toLowerCase().includes("block")
                ? "destructive"
                : "secondary"
            }
          >
            {link.link_type}
          </Badge>
        ) : (
          ""
        )}
      </td>
    </tr>
  );
}
