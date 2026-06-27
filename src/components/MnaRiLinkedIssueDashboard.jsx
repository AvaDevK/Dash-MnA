import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import SbrPicker from "./SbrPicker";
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
  Legend,
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

// Avalara brand palette
const AV = {
  orange: "#F37021",
  navy: "#1E3A5F",
  green: "#00B050",
  amber: "#EAB308",
  red: "#C00000",
  blue: "#0369A1",
  greenLight: "#E6F6EC",
  amberLight: "#FEF9C3",
  redLight: "#FFEBEB",
  blueLight: "#E0F2FE",
  orangeLight: "#FFF4ED",
};

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
  if (["done", "closed", "resolved", "cancelled", "canceled"].some((x) => s.includes(x)))
    return "bg-emerald-50 text-emerald-700 border-emerald-300";
  if (["blocked", "on hold"].some((x) => s.includes(x)))
    return "bg-red-50 text-red-700 border-red-300";
  if (["progress", "waiting", "production", "review", "active"].some((x) => s.includes(x)))
    return "bg-yellow-50 text-yellow-700 border-yellow-300";
  if (["todo", "to do", "new", "elaboration", "ideation", "backlog", "open"].some((x) => s.includes(x)))
    return "bg-sky-50 text-sky-700 border-sky-300";
  if (s.includes("cancel")) return "bg-slate-100 text-slate-600 border-slate-200";
  return "bg-gray-50 text-gray-600 border-gray-200";
}

function completionTone(pct) {
  if (pct >= 67) return { bg: "bg-emerald-500", text: "text-emerald-700", bar: "#00B050" };
  if (pct >= 33) return { bg: "bg-yellow-400", text: "text-yellow-700", bar: "#EAB308" };
  return { bg: "bg-red-500", text: "text-red-700", bar: "#C00000" };
}

// ─── API-mode adapter: MnaInitiative → tree node format used by TreeNode ─────

function adaptLinkedToRow(l) {
  return {
    linked_key: l.key,
    linked_title: l.summary,
    linked_status: l.statusName,
    linked_issuetype: l.issueType,
    link_type: l.rawLinkType || l.linkType,
    link_direction: l.direction,
  };
}

function adaptTreeNodeToNode(node) {
  return {
    id: `${node.issueType.toLowerCase().replace(/\s+/g, "-")}:${node.key}`,
    type: node.issueType.toLowerCase().includes("sub") ? "subtask"
      : node.issueType.toLowerCase().includes("epic") ? "epic"
      : node.issueType.toLowerCase().includes("task") ? "task"
      : "story",
    key: node.key,
    title: node.summary,
    status: node.statusName,
    issuetype: node.issueType,
    completionPct: node.completionPct,
    children: node.children.map(adaptTreeNodeToNode),
    links: node.linked.map(adaptLinkedToRow),
  };
}

function adaptInitiativeToNode(init) {
  return {
    id: `initiative:${init.key}`,
    type: "initiative",
    key: init.key,
    title: init.mnaName || init.summary,
    status: init.statusName,
    issuetype: "Initiative",
    completionPct: init.completionPct,
    children: init.roadmapItems.map((ri) => ({
      id: `roadmap:${ri.key}`,
      type: "roadmap",
      key: ri.key,
      title: ri.summary,
      status: ri.statusName,
      issuetype: ri.issueType,
      riBucket: ri.riBucket,
      completionPct: ri.completionPct,
      children: ri.children.map(adaptTreeNodeToNode),
      links: ri.linked.map(adaptLinkedToRow),
    })),
    links: init.linked.map(adaptLinkedToRow),
  };
}

function apiDataToRows(apiData) {
  if (!apiData?.initiatives) return [];
  const rows = [];
  // Backend MnaTreeNode fields: key, summary, statusName, issueType, linked[], children[]
  const walkNode = (node, init, ri, epicCtx) => {
    const typeStr = (node.issueType || node.issuetype || "").toLowerCase();
    const isEpic = typeStr.includes("epic");
    const isSubtask = typeStr.includes("sub");
    const title = node.summary || node.title || "";
    const newEpicCtx = isEpic ? { key: node.key, title, status: node.statusName } : epicCtx;
    // node.linked is backend MnaLinkedIssue[]; node.links is already-adapted (adapted nodes)
    const rawLinks = node.linked || [];
    const adaptedLinks = rawLinks.map(adaptLinkedToRow);
    for (const link of adaptedLinks) {
      rows.push({
        initiative_key: init.key,
        initiative_title: init.mnaName || init.summary,
        initiative_status: init.statusName,
        roadmap_key: ri?.key || "",
        roadmap_title: ri?.summary || "",
        roadmap_status: ri?.statusName || "",
        epic_key: newEpicCtx?.key || "",
        epic_title: newEpicCtx?.title || "",
        epic_status: newEpicCtx?.status || "",
        story_key: (!isEpic && !isSubtask) ? node.key : "",
        story_title: (!isEpic && !isSubtask) ? title : "",
        story_status: (!isEpic && !isSubtask) ? node.statusName : "",
        story_issuetype: (!isEpic && !isSubtask) ? (node.issueType || node.issuetype || "") : "",
        subtask_key: isSubtask ? node.key : "",
        subtask_title: isSubtask ? title : "",
        subtask_status: isSubtask ? node.statusName : "",
        subtask_issuetype: isSubtask ? (node.issueType || node.issuetype || "") : "",
        linked_key: link.linked_key,
        linked_title: link.linked_title,
        linked_status: link.linked_status,
        linked_issuetype: link.linked_issuetype,
        link_type: link.link_type,
        link_direction: link.link_direction,
      });
    }
    for (const child of node.children || []) walkNode(child, init, ri, newEpicCtx);
  };
  for (const init of apiData.initiatives) {
    if (init.roadmapItems.length === 0) {
      rows.push({ initiative_key: init.key, initiative_title: init.mnaName || init.summary, initiative_status: init.statusName, link_type: "NO LINKS" });
      continue;
    }
    for (const ri of init.roadmapItems) {
      const riLinks = (ri.linked || []).map(adaptLinkedToRow);
      if (riLinks.length === 0 && (ri.children || []).length === 0) {
        rows.push({ initiative_key: init.key, initiative_title: init.mnaName || init.summary, initiative_status: init.statusName, roadmap_key: ri.key, roadmap_title: ri.summary, roadmap_status: ri.statusName, link_type: "NO LINKS" });
      }
      for (const link of riLinks) {
        rows.push({ initiative_key: init.key, initiative_title: init.mnaName || init.summary, initiative_status: init.statusName, roadmap_key: ri.key, roadmap_title: ri.summary, roadmap_status: ri.statusName, linked_key: link.linked_key, linked_title: link.linked_title, linked_status: link.linked_status, linked_issuetype: link.linked_issuetype, link_type: link.link_type, link_direction: link.link_direction });
      }
      for (const child of ri.children || []) walkNode(child, init, ri, null);
    }
    for (const l of init.linked || []) {
      const link = adaptLinkedToRow(l);
      rows.push({ initiative_key: init.key, initiative_title: init.mnaName || init.summary, initiative_status: init.statusName, linked_key: link.linked_key, linked_title: link.linked_title, linked_status: link.linked_status, linked_issuetype: link.linked_issuetype, link_type: link.link_type, link_direction: link.link_direction });
    }
  }
  return rows;
}

export default function MnaRiLinkedIssueDashboard() {
  const [csvText, setCsvText] = useState("");
  const [inputMode, setInputMode] = useState("api");
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const [sbrKey, setSbrKey] = useState("SBR-356");
  const [sbrInput, setSbrInput] = useState("SBR-356");
  const [jiraJql, setJiraJql] = useState(`SBR-356`);
  const [jiraLoading, setJiraLoading] = useState(false);
  const [jiraError, setJiraError] = useState("");
  const [jiraLastPulled, setJiraLastPulled] = useState(0);

  // Live API (Snowflake/Jira) state
  const [apiData, setApiData] = useState(null);
  const [apiLoading, setApiLoading] = useState(false);
  const [apiError, setApiError] = useState("");
  const [apiLastPulled, setApiLastPulled] = useState(0);

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
      (node.children || []).forEach(walk);
    };
    const activeHierarchy = (inputMode === "api" && apiHierarchy?.length > 0) ? apiHierarchy : hierarchy;
    activeHierarchy.forEach(walk);
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

  // Must be declared before any useMemo that references it in deps or body
  const isApiMode = inputMode === "api" && !!apiData;

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
    if (isApiMode && apiData) {
      const inits = selectedMnas.size === 0 ? (apiData.initiatives || []) : (apiData.initiatives || []).filter((i) => selectedMnas.has(i.mnaName));
      const buckets = new Map();
      for (const init of inits) {
        for (const ri of init.roadmapItems || []) {
          const b = ri.riBucket || "Unknown";
          if (!buckets.has(b)) buckets.set(b, { completions: [], linked: 0, zero: 0 });
          const entry = buckets.get(b);
          entry.completions.push(ri.completionPct ?? 0);
          const hasLinks = ri.linked.length > 0 || ri.children.length > 0;
          entry.linked += ri.linked.length;
          if (!hasLinks) entry.zero++;
        }
      }
      return [...buckets.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
        .map(([name, e]) => ({
          name,
          completion: e.completions.length ? Math.round(e.completions.reduce((a, v) => a + v, 0) / e.completions.length) : 0,
          linked: e.linked,
          zero: e.zero,
        }));
    }
    return ris.map((ri) => {
      const p = parents.filter((x) => x.ri === ri);
      const completionList = p
        .map((x) => calculateRICompletion(filteredRows, x.parent_key))
        .filter((v) => !Number.isNaN(v));
      const avg = completionList.length
        ? Math.round(completionList.reduce((a, b) => a + b, 0) / completionList.length)
        : 0;
      return {
        name: ri,
        completion: avg,
        linked: p.reduce((sum, x) => sum + x.links.length, 0),
        zero: p.filter((x) => x.links.length === 0).length,
      };
    });
  }, [isApiMode, apiData, ris, parents, filteredRows, selectedMnas]);

  const effectiveRows = useMemo(() => {
    const base = isApiMode ? apiDataToRows(apiData) : rows;
    if (selectedMnas.size === 0) return base;
    return base.filter((r) => selectedMnas.has(r.initiative_title || getInitiative(r)));
  }, [isApiMode, apiData, rows, selectedMnas]);

  const apiParents = useMemo(() => {
    if (!isApiMode) return [];
    const map = new Map();
    effectiveRows.forEach((r) => {
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
  }, [isApiMode, effectiveRows]);

  const filteredParents = useMemo(() => {
    return (isApiMode ? apiParents : parents).filter((p) => {
      const q = search.toLowerCase();
      const searchable = `${p.parent_key} ${p.parent_title} ${p.parent_status} ${p.links
        .map((l) => `${l.linked_key} ${l.linked_title} ${l.linked_status} ${l.link_type}`)
        .join(" ")}`.toLowerCase();
      const matchesSearch = !q || searchable.includes(q);
      const matchesMna = mnaFilter === "all" || p.mna === mnaFilter;
      const matchesRi = riFilter === "all" || p.ri === riFilter;
      const hasBlocker = p.links.some((l) => (l.link_type || "").toLowerCase().includes("block"));
      const zeroLinks = p.links.length === 0;
      const hasGap = p.links.some((l) => /\[gap\]|gap/i.test(l.linked_title || ""));
      const matchesRisk =
        riskFilter === "all" ||
        (riskFilter === "blocked" && hasBlocker) ||
        (riskFilter === "zero" && zeroLinks) ||
        (riskFilter === "gap" && hasGap);
      return matchesSearch && matchesMna && matchesRi && matchesRisk;
    });
  }, [isApiMode, apiParents, parents, search, mnaFilter, riFilter, riskFilter]);

  const apiMnas = useMemo(() => {
    if (!isApiMode) return [];
    return (apiData?.filterOptions?.mnaNames || []);
  }, [isApiMode, apiData]);

  const apiInitiativeSummaries = useMemo(() => {
    if (!isApiMode || !apiData) return [];
    const all = apiData.initiatives || [];
    const filtered = selectedMnas.size === 0 ? all : all.filter((i) => selectedMnas.has(i.mnaName));
    return filtered.map((init) => ({
      key: init.key,
      name: init.mnaName,
      completion: Math.round(init.completionPct * 10) / 10,
      pending: Math.round((100 - init.completionPct) * 10) / 10,
      riCount: init.roadmapItems.length,
      linkedIssues: init.totalLinkCount,
      zeroLinkRis: init.roadmapItems.filter((ri) => ri.linked.length === 0 && ri.children.length === 0).length,
      isEndOfLife: init.isEndOfLife ?? false,
      lifecycleLabel: init.lifecycleLabel ?? null,
    })).sort((a, b) => a.completion - b.completion);
  }, [isApiMode, apiData, selectedMnas]);

  const apiCompletionAvg = useMemo(() => {
    if (!isApiMode || !apiInitiativeSummaries.length) return 0;
    return Math.round(apiInitiativeSummaries.reduce((s, x) => s + x.completion, 0) / apiInitiativeSummaries.length);
  }, [isApiMode, apiInitiativeSummaries]);

  const apiMetrics = useMemo(() => {
    if (!isApiMode || !apiData) return null;
    const inits = selectedMnas.size === 0
      ? (apiData.initiatives || [])
      : (apiData.initiatives || []).filter((i) => selectedMnas.has(i.mnaName));
    const kpis = apiData.kpis || {};
    return {
      mnas: inits.length,
      parents: inits.reduce((s, i) => s + i.roadmapItems.length, 0),
      linkedRows: inits.reduce((s, i) => s + i.totalLinkCount, 0),
      zeroParents: inits.filter((i) => i.roadmapItems.length === 0 || i.roadmapItems.every((r) => r.children.length === 0 && r.linked.length === 0)).length,
      blockers: kpis.openBlockers ?? 0,
      gaps: kpis.openDependencies ?? 0,
    };
  }, [isApiMode, apiData, selectedMnas]);

  const apiHierarchy = useMemo(() => {
    if (!isApiMode || !apiData) return [];
    const all = apiData.initiatives || [];
    const filtered = selectedMnas.size === 0 ? all : all.filter((i) => selectedMnas.has(i.mnaName));
    return filtered.map((init) => adaptInitiativeToNode(init));
  }, [isApiMode, apiData, selectedMnas]);

  const apiMnaChart = useMemo(() => {
    return apiInitiativeSummaries.map((g) => ({
      name: g.name, completion: g.completion, pending: g.pending, linked: g.linkedIssues,
      isEndOfLife: g.isEndOfLife, lifecycleLabel: g.lifecycleLabel,
    }));
  }, [apiInitiativeSummaries]);

  const coverageData = useMemo(() => {
    if (isApiMode && apiData) {
      const inits = selectedMnas.size === 0 ? (apiData.initiatives || []) : (apiData.initiatives || []).filter((i) => selectedMnas.has(i.mnaName));
      const riList = inits.flatMap((i) => i.roadmapItems || []);
      const withLinks = riList.filter((ri) => ri.linked.length > 0 || ri.children.length > 0).length;
      return [
        { name: "RIs with links", value: withLinks },
        { name: "RIs without links", value: riList.length - withLinks },
      ];
    }
    return [
      { name: "Parents with links", value: metrics.parents - metrics.zeroParents },
      { name: "Parents without links", value: metrics.zeroParents },
    ];
  }, [isApiMode, apiData, metrics, selectedMnas]);

  const PIE_COLORS = ["#00B050", "#F37021"];

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
    setInputMode("paste");
    setApiData(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function pullFromApi(forceRefresh = false, sbr = sbrKey) {
    setApiLoading(true);
    setApiError("");
    try {
      const params = new URLSearchParams();
      params.set("sbr", sbr);
      if (selectedMnas.size > 0) params.set("mna", [...selectedMnas].join(","));
      if (riFilter !== "all") params.set("ri", riFilter);
      if (riskFilter !== "all") params.set("risk", riskFilter);
      if (search) params.set("q", search);
      if (forceRefresh) params.set("refresh", "true");
      const resp = await fetch(`/api/mna?${params.toString()}`);
      if (!resp.ok) {
        let msg = `HTTP ${resp.status}`;
        try { const j = await resp.json(); if (j.reason) msg = j.reason; else if (j.error) msg = j.error; } catch { /* ignore */ }
        throw new Error(msg);
      }
      const data = await resp.json();
      if (!data.initiatives) throw new Error("Unexpected API response shape");
      setApiData(data);
      setApiLastPulled(Date.now());
      setLoadedAt(Date.now());
    } catch (err) {
      setApiError(err.message || String(err));
    } finally {
      setApiLoading(false);
    }
  }

  async function pullFromJira() {
    setJiraLoading(true);
    setJiraError("");
    try {
      const resp = await fetch("/api/jira-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sbr: jiraJql.trim() }),
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
        throw new Error("Jira returned 0 issues for that SBR.");
      }
      setCsvText(text);
      setUploadedFileName(`Jira live: ${jiraJql} full hierarchy`);
      setUploadError("");
      setLoadedAt(Date.now());
      setJiraLastPulled(Date.now());
    } catch (err) {
      setJiraError(err.message || String(err));
    } finally {
      setJiraLoading(false);
    }
  }

  // Auto-pull from API on mount
  useEffect(() => {
    pullFromApi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-6 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <div
                className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold text-white"
                style={{ background: AV.navy }}
              >
                <BarChart3 className="h-3.5 w-3.5" /> Executive Dashboard
              </div>
              <div
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
                style={{ background: AV.orangeLight, color: AV.orange }}
              >
                <span className="h-2 w-2 rounded-full inline-block" style={{ background: AV.orange }} />
                Live · Snowflake + Jira
              </div>
            </div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: AV.navy }}>
              SBR Jira Intelligence
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Hierarchy dashboard for any SBR · Initiative → Roadmap Item → Epic → Story → linked Jira issues · Snowflake-first with Jira REST fallback
            </p>
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide shrink-0">SBR:</label>
              <SbrPicker
                value={sbrKey}
                onChange={(val) => {
                  setSbrKey(val);
                  setSbrInput(val);
                  setJiraJql(val);
                }}
                onLoad={(val) => {
                  if (inputMode === "api") pullFromApi(true, val);
                }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={exportFiltered}
              variant="outline"
              className="gap-2 rounded-xl border-slate-300"
            >
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {[
            { id: "overview", label: "Dashboard", icon: <BarChart3 className="h-3.5 w-3.5" /> },
            { id: "executive", label: "Executive Summary", icon: <TrendingUp className="h-3.5 w-3.5" /> },
            { id: "quality", label: "Data Quality", icon: <CircleCheck className="h-3.5 w-3.5" /> },
            { id: "live", label: "Glean: SBR Fetch", icon: <RefreshCw className="h-3.5 w-3.5" /> },
          ].map((t) => (
            <Button
              key={t.id}
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab(t.id)}
              className="gap-1.5 rounded-lg text-sm"
              style={activeTab === t.id ? { background: AV.navy, color: "white" } : {}}
            >
              {t.icon} {t.label}
            </Button>
          ))}
        </div>

        {(isApiMode ? apiMnas : mnas).length > 0 && (
          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardContent className="flex flex-wrap items-center gap-2 p-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Filter by Initiative
              </span>
              {(isApiMode ? apiMnas : mnas).map((m) => {
                const active = isMnaActive(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggleMna(m)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                      active
                        ? "text-white border-transparent"
                        : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                    style={active ? { background: AV.orange, borderColor: AV.orange } : {}}
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
                  ? `Showing all ${(isApiMode ? apiMnas : mnas).length} initiatives`
                  : `Showing ${selectedMnas.size} of ${(isApiMode ? apiMnas : mnas).length} initiatives`}
              </span>
              <InfoTip title="Initiative filter" side="left">
                Click initiative chips to focus the entire dashboard — <b>every chart, KPI, and table on every tab</b> updates instantly. Click again to deselect. <b>Show all</b> clears the filter.
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
                <FileSpreadsheet className="h-4 w-4" /> Live Data
                <InfoTip title="How to load data" side="right">
                  Load Jira data as CSV via <b>Paste</b>, <b>Upload</b>, or <b>Live Jira Fetch</b>. Minimum required columns: <code>roadmap_key</code> and <code>roadmap_title</code> (or their <code>parent_*</code> equivalents). All other columns are optional.
                </InfoTip>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={inputMode === "paste" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setInputMode("paste")}
                  className="gap-2"
                  style={inputMode === "paste" ? { background: AV.navy, color: "white", borderColor: AV.navy } : {}}
                >
                  <FileSpreadsheet className="h-4 w-4" /> Paste CSV
                </Button>
                <Button
                  variant={inputMode === "upload" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setInputMode("upload")}
                  className="gap-2"
                  style={inputMode === "upload" ? { background: AV.navy, color: "white", borderColor: AV.navy } : {}}
                >
                  <Upload className="h-4 w-4" /> Upload CSV
                </Button>
                <Button
                  variant={inputMode === "jira" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setInputMode("jira")}
                  className="gap-2"
                  style={inputMode === "jira" ? { background: AV.navy, color: "white", borderColor: AV.navy } : {}}
                >
                  <RefreshCw className="h-4 w-4" /> Live Jira Fetch
                </Button>
                <Button
                  variant={inputMode === "api" ? "default" : "outline"}
                  size="sm"
                  onClick={() => { setInputMode("api"); if (!apiData) pullFromApi(); }}
                  className="gap-2"
                  style={inputMode === "api" ? { background: AV.navy, color: "white", borderColor: AV.navy } : {}}
                >
                  <TrendingUp className="h-4 w-4" /> Live Data (API)
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
                    SBR Key
                  </label>
                  <InfoTip title="Live Jira Hierarchy Fetch" side="right">
                    Hits <code>/api/jira-export</code> with the selected SBR key. Walks the full 5-level hierarchy — SBR → Initiatives → Roadmap Items → Epics → Stories/Tasks → Sub-tasks — and returns CSV in the dashboard schema with all parent context columns filled in.
                  </InfoTip>
                </div>
                <Input
                  value={jiraJql}
                  onChange={(e) => setJiraJql(e.target.value.trim().toUpperCase())}
                  placeholder='e.g. SBR-356'
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
            {inputMode === "api" && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Auto-Select: Snowflake + Jira REST
                  </label>
                  <InfoTip title="Live API pull" side="right">
                    Calls <code>/api/mna?sbr=…</code> — queries <b>Snowflake</b> (<code>DS_PROD_INGEST.JIRA.ISSUES</code>) first, falls back to <b>Jira REST</b> if Snowflake is unavailable. Returns the full initiative hierarchy pre-assembled with completion rollup. Change the SBR key above to load any SBR.
                  </InfoTip>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => pullFromApi(false)}
                    disabled={apiLoading}
                    className="gap-2"
                  >
                    {apiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
                    {apiLoading ? "Loading..." : "Pull from API"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => pullFromApi(true)}
                    disabled={apiLoading}
                    className="gap-2"
                  >
                    <RefreshCw className="h-4 w-4" /> Force Refresh
                  </Button>
                  {apiLastPulled > 0 && !apiError && apiData && (
                    <span className="text-xs text-slate-500">
                      Last pulled {new Date(apiLastPulled).toLocaleTimeString()} ·{" "}
                      <span className="font-medium">{apiData.repoHealth?.sourceLabel ?? "unknown"}</span>
                      {apiData.cacheStatus === "HIT" && (
                        <span className="ml-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] text-sky-700">cached {apiData.cacheAgeSeconds}s</span>
                      )}
                    </span>
                  )}
                </div>
                {apiError && (
                  <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <div>
                      <div className="font-semibold">API pull failed</div>
                      <div className="text-xs">{apiError}</div>
                      <div className="mt-1 text-[11px] text-rose-700">
                        Set <code>MNA_DATA_SOURCE</code> (auto/jira/snowflake), Snowflake creds (<code>SNOWFLAKE_USER</code>, <code>SNOWFLAKE_PRIVATE_KEY</code>, etc.) and/or Jira creds (<code>JIRA_EMAIL</code>, <code>JIRA_API_TOKEN</code>) in Vercel env vars.
                      </div>
                    </div>
                  </div>
                )}
                {apiData && !apiError && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-800">
                    ✓ Loaded {apiData.initiatives.length} initiative(s) · {apiData.extractionTelemetry?.roadmapItemCount ?? "?"} RIs · source:{" "}
                    <b style={{ color: AV.orange }}>{apiData.repoHealth?.sourceLabel}</b>
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
            title="Initiatives"
            value={(isApiMode ? apiMetrics : metrics)?.mnas ?? 0}
            icon={<CircleCheck />}
            accent={AV.navy}
            tip="Distinct Initiatives linked under this SBR."
          />
          <Metric
            title="Roadmap Items"
            value={(isApiMode ? apiMetrics : metrics)?.parents ?? 0}
            icon={<CircleDashed />}
            accent={AV.blue}
            tip="Total Roadmap Items (RIs) loaded."
          />
          <Metric
            title="Linked Issues"
            value={(isApiMode ? apiMetrics : metrics)?.linkedRows ?? 0}
            icon={<Link2 />}
            accent={AV.blue}
            tip="Total linked issues across all RIs and descendants."
          />
          <Metric
            title={isApiMode ? "Open Gaps" : "No-Link RIs"}
            value={(isApiMode ? apiMetrics : metrics)?.zeroParents ?? 0}
            icon={<AlertTriangle />}
            warn
            tip={isApiMode ? "Initiatives with no Roadmap Items or all empty RIs — gaps in SBR coverage." : "Roadmap Items that have no linked Jira issues."}
          />
          <Metric
            title="Blockers"
            value={(isApiMode ? apiMetrics : metrics)?.blockers ?? 0}
            icon={<AlertTriangle />}
            danger
            tip="Active 'is blocked by' linked issues that are not yet done."
          />
          <Metric
            title={isApiMode ? "Open Deps" : "Gap Issues"}
            value={(isApiMode ? apiMetrics : metrics)?.gaps ?? 0}
            icon={<Search />}
            warn
            tip={isApiMode ? "Open 'blocks' links — issues this initiative is blocking." : "Linked rows whose title contains '[GAP]'."}
          />
        </div>

        {/* INITIATIVE COMPLETION OVERVIEW */}
        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">SBR-Linked Initiatives Progress</h2>
                  <InfoTip title="How completion is calculated" side="right">
                    Each Initiative's completion is the average across its Roadmap Items (RIs). An RI's completion = % of child Jira records (epics, stories, sub-tasks, linked issues) whose status is Done / Closed / Resolved / Cancelled. RIs with no children fall back to their own status. Linked issues are de-duplicated per Initiative. <b>Pending = 100 − Completion.</b>
                  </InfoTip>
                </div>
                <p className="text-xs text-slate-500">
                  Portfolio average: <b style={{ color: AV.orange }}>{isApiMode ? apiCompletionAvg : initiativeCompletionAvg}%</b> complete · <b style={{ color: AV.orange }}>{100 - (isApiMode ? apiCompletionAvg : initiativeCompletionAvg)}%</b> pending
                </p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-white" style={{ background: AV.navy }}>
                <TrendingUp className="h-3.5 w-3.5" /> {isApiMode ? `Rollup from ${apiData?.repoHealth?.sourceLabel ?? "API"}` : "Rollup from Jira status"}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {(isApiMode ? apiInitiativeSummaries : initiativeSummaries).map((g) => (
                <InitiativeCard key={g.key} g={g} onNavigate={(name) => { setActiveTab("overview"); setViewMode("hierarchy"); if (name) setSelectedMnas(new Set([name])); }} />
              ))}
              {(isApiMode ? apiInitiativeSummaries : initiativeSummaries).length === 0 && (
                <div className="col-span-full rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
                  {isApiMode && apiLoading ? "Loading from API..." : isApiMode ? "No initiative data returned." : "No Initiative data in the current CSV."}
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
                <h2 className="font-semibold">Completion vs Pending (Per Initiative)</h2>
                <InfoTip title="What this shows" side="right">
                  Stacked bar of <b>Completion %</b> (green) vs <b>Pending %</b> (orange) for each Initiative under this SBR. Driven by Jira statuses of epics, stories, sub-tasks and linked records under each Roadmap Item. Use this to see which initiatives still have material open work.
                </InfoTip>
              </div>
              {isApiMode && (isApiMode ? apiMnaChart : mnaChart).some((r) => r.isEndOfLife) && (
                <div className="mb-2 flex items-center gap-1.5 text-[11px]" style={{ color: "#C00000" }}>
                  <span className="inline-block h-2.5 w-2.5 rounded-sm border-2 bg-slate-300" style={{ borderColor: "#C00000" }} />
                  <span>Grey bars with red outline = End of Life / Retired (LeanIX + M&A engineering records)</span>
                </div>
              )}
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={isApiMode ? apiMnaChart : mnaChart}
                    margin={{ top: 8, right: 12, left: 0, bottom: 48 }}
                    style={{ cursor: "pointer" }}
                    onClick={(data) => { if (data?.activePayload?.[0]?.payload?.name) { setActiveTab("overview"); setViewMode("hierarchy"); setSelectedMnas(new Set([data.activePayload[0].payload.name])); } }}
                  >
                    <XAxis
                      dataKey="name"
                      angle={-25}
                      textAnchor="end"
                      interval={0}
                      height={70}
                      fontSize={11}
                      tick={({ x, y, payload }) => {
                        const row = (isApiMode ? apiMnaChart : mnaChart).find((r) => r.name === payload.value);
                        return (
                          <g transform={`translate(${x},${y})`}>
                            <text x={0} y={0} dy={8} textAnchor="end" fontSize={11} transform="rotate(-25)"
                              fill={row?.isEndOfLife ? "#9CA3AF" : "#374151"}
                            >
                              {payload.value}{row?.isEndOfLife ? " ⊘" : ""}
                            </text>
                          </g>
                        );
                      }}
                    />
                    <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const row = payload[0]?.payload;
                        return (
                          <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-xl">
                            <div className="font-semibold text-slate-800 mb-1">{row?.name}</div>
                            {row?.isEndOfLife && (
                              <div className="mb-1.5 font-semibold" style={{ color: "#C00000" }}>
                                ⊘ {row.lifecycleLabel || "End of Life / Retired"}
                              </div>
                            )}
                            {payload.map((p) => (
                              <div key={p.dataKey} className="flex items-center gap-2">
                                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: p.fill }} />
                                <span className="capitalize">{p.name}</span>
                                <span className="ml-auto font-mono">{p.value}%</span>
                              </div>
                            ))}
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="completion" stackId="pct" name="Completion" fill="#00B050" radius={[0, 0, 0, 0]}>
                      {(isApiMode ? apiMnaChart : mnaChart).map((row, i) => (
                        <Cell
                          key={i}
                          fill={row.isEndOfLife ? "#9CA3AF" : "#00B050"}
                          stroke={row.isEndOfLife ? "#C00000" : undefined}
                          strokeWidth={row.isEndOfLife ? 2 : 0}
                        />
                      ))}
                      <LabelList
                        dataKey="completion"
                        position="insideTop"
                        formatter={(v) => (v >= 12 ? `${v}%` : "")}
                        fill="#ecfdf5"
                        fontSize={11}
                      />
                    </Bar>
                    <Bar dataKey="pending" stackId="pct" name="Pending" fill="#F37021" radius={[8, 8, 0, 0]}>
                      {(isApiMode ? apiMnaChart : mnaChart).map((row, i) => (
                        <Cell
                          key={i}
                          fill={row.isEndOfLife ? "#D1D5DB" : "#F37021"}
                          stroke={row.isEndOfLife ? "#C00000" : undefined}
                          strokeWidth={row.isEndOfLife ? 2 : 0}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardContent className="p-4">
              <div className="mb-4 flex items-center gap-2">
                <h2 className="font-semibold">RI Coverage</h2>
                <InfoTip title="What this shows" side="left">
                  Share of Roadmap Items (RIs) that have at least one linked Jira issue vs RIs with none. Low coverage means dependencies aren't being mapped — a risk signal for leadership review.
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
              <h2 className="font-semibold">Workstream Coverage by RI Bucket</h2>
              <InfoTip title="What this shows" side="right">
                Groups Roadmap Items by RI bucket (e.g. RI1, RI2 — parsed from the <code>(RIn)</code> token in roadmap titles or labels). Shows average completion per bucket, total linked issues, and count of zero-link RIs. Use this to compare progress across workstreams for any SBR.
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
                    fill="#00B050"
                  />
                  <Bar
                    dataKey="linked"
                    name="Linked Issues"
                    radius={[8, 8, 0, 0]}
                    fill="#0369A1"
                  />
                  <Bar
                    dataKey="zero"
                    name="Zero-Link Parents"
                    radius={[8, 8, 0, 0]}
                    fill="#EAB308"
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
                  <h2 className="font-semibold">Issue Hierarchy &amp; Dependencies</h2>
                  <p className="text-xs text-slate-500">
                    Drill down into the full SBR → Initiative → Roadmap → Epic → Story hierarchy with live status
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
                  style={viewMode === "hierarchy" ? { background: AV.navy, color: "white", borderColor: AV.navy } : {}}
                >
                  <ChevronRight className="h-4 w-4" /> Hierarchy
                </Button>
                <Button
                  variant={viewMode === "flat" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("flat")}
                  style={viewMode === "flat" ? { background: AV.navy, color: "white", borderColor: AV.navy } : {}}
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
                hierarchy={isApiMode ? apiHierarchy : hierarchy}
                expanded={expanded}
                toggle={toggle}
                search={search}
                mnaFilter={mnaFilter}
                riFilter={riFilter}
                riskFilter={riskFilter}
                rows={isApiMode ? [] : filteredRows}
              />
            ) : (
              <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                <div className="max-h-[540px] overflow-auto">
                <table className="w-full border-collapse text-sm">
                  <thead style={{ background: AV.navy }} className="sticky top-0 z-10">
                    <tr>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wide text-white">Initiative / Roadmap Item</th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wide text-white">Status</th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wide text-white">Linked Issue</th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wide text-white">Linked Status</th>
                      <th className="p-3 text-left text-xs font-semibold uppercase tracking-wide text-white">Link Type</th>
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
              </div>
            )}
          </CardContent>
        </Card>
        </>)}

        {activeTab === "executive" && <ExecutivePortfolio rows={effectiveRows} onNavigate={(name) => { if (name) setSelectedMnas(new Set([name])); }} />}
        {activeTab === "quality" && <DataQuality rows={effectiveRows} onNavigate={(name) => { if (name) setSelectedMnas(new Set([name])); }} />}
        {activeTab === "live" && <GleanAgent />}

        <SourceBanner rows={effectiveRows} uploadedFileName={uploadedFileName} loadedAt={loadedAt} inputMode={inputMode} apiData={apiData} sbrKey={sbrKey} />
      </div>
    </div>
  );
}

function InitiativeCard({ g, onNavigate }) {
  const tone = completionTone(g.completion);
  const eol = g.isEndOfLife;
  const ringColor = eol ? "#9CA3AF" : tone.bar;
  const circumference = 100.5; // r=16
  const filled = (g.completion / 100) * circumference;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onNavigate?.(g.name)}
      onKeyDown={(e) => e.key === "Enter" && onNavigate?.(g.name)}
      className={`group relative flex flex-col gap-2 rounded-xl border p-3 shadow-sm transition-all cursor-pointer hover:shadow-md hover:-translate-y-0.5 ${eol ? "border-red-600 bg-red-50/40" : "border-slate-200 bg-white"}`}
      style={eol ? {} : { borderLeft: `4px solid ${tone.bar}` }}
      title="Click to view in hierarchy"
    >
      {/* Header: name + mini donut */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {eol && (
            <span className="mb-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide" style={{ background: "#FEE2E2", color: "#C00000" }}>
              ⊘ {g.lifecycleLabel || "End of Life"}
            </span>
          )}
          <div className={`text-[13px] font-bold leading-tight ${eol ? "text-slate-400" : "text-slate-900 group-hover:text-blue-700"}`}>{g.name}</div>
          <div className="mt-0.5 text-[10px] text-slate-400">{g.key} · {g.riCount} RI{g.riCount === 1 ? "" : "s"}</div>
        </div>
        {/* Mini donut ring */}
        <svg width="40" height="40" viewBox="0 0 36 36" className="flex-shrink-0">
          <circle cx="18" cy="18" r="16" fill="none" stroke="#E2E8F0" strokeWidth="3.5" />
          <circle cx="18" cy="18" r="16" fill="none" stroke={ringColor} strokeWidth="3.5"
            strokeDasharray={`${filled} ${circumference}`} strokeLinecap="round" transform="rotate(-90 18 18)" />
          <text x="18" y="22" textAnchor="middle" fontSize="8.5" fontWeight="bold" fill={eol ? "#9CA3AF" : tone.bar}>{g.completion}%</text>
        </svg>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full transition-all" style={{ width: `${g.completion}%`, background: ringColor }} />
      </div>

      {/* Stats row */}
      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span><span className="font-semibold text-slate-600">{g.pending}%</span> pending</span>
        <span className="flex items-center gap-1.5">
          <span>{g.linkedIssues} linked</span>
          {g.zeroLinkRis > 0 && (
            <span className="rounded px-1 py-0.5 font-semibold" style={{ background: "#FEF3C7", color: "#92400E" }}>
              {g.zeroLinkRis} gap{g.zeroLinkRis === 1 ? "" : "s"}
            </span>
          )}
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
    <div className="mt-4 max-h-[640px] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3">
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
  if (node.completionPct !== undefined && node.completionPct !== null) {
    // Pre-computed by server (API mode) — use directly
    completion = Math.round(node.completionPct * 10) / 10;
  } else if (node.type === "initiative") {
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

function Metric({ title, value, icon, warn, danger, tip, accent }) {
  const color = danger ? AV.red : warn ? AV.amber : accent || AV.blue;
  const lightBg = danger ? "#FFEBEB" : warn ? "#FEF9C3" : accent === AV.orange ? AV.orangeLight : AV.blueLight;
  return (
    <Card className="rounded-xl border-slate-200 shadow-sm overflow-hidden">
      <div style={{ borderLeft: `4px solid ${color}` }}>
        <CardContent className="flex items-center justify-between p-4">
          <div>
            <div className="flex items-center gap-1.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
              {tip && <InfoTip title={title} side="right">{tip}</InfoTip>}
            </div>
            <div className="mt-1 text-2xl font-bold" style={{ color }}>{value}</div>
          </div>
          <div className="rounded-xl p-2.5" style={{ background: lightBg, color }}>
            {React.cloneElement(icon, { className: "h-5 w-5" })}
          </div>
        </CardContent>
      </div>
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
