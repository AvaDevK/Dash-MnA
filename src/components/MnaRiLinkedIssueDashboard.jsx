import React, { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Upload, AlertTriangle, Link2, BarChart3, CircleCheck, CircleDashed, Download, ChevronRight, ChevronDown } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const SAMPLE_CSV = `initiative_key,initiative_title,initiative_status,roadmap_key,roadmap_title,roadmap_status,epic_key,epic_title,epic_status,story_key,story_title,story_status,linked_key,linked_title,linked_status,link_type
MNA-DAVO,DAVO,Active,MNAC-27,DAVO | Reliability Engineering Work (RI1),Closed,RELE-320389,DAVO - Reliability Engineering,Done,RELE-320389-1,Monitoring story,In Progress,OBS-101,Observability dependency,To Do,relates to
MNA-DAVO,DAVO,Active,MNAC-11,DAVO | Shared Services Adoption (RI4),Elaboration,D30-9695,DAVO - Console Integration,To Do,D30-9695-1,Console migration story,To Do,IAM-8727,[GAP] DAVO IAM Assessment,To Do,is blocked by
MNA-DAVO,DAVO,Active,MNAC-25,DAVO | AVATech Onboarding (RI2),Closed,,,,,,,,,,
MNA-1099,Track1099,Active,MNAC-31,Track1099 | Reliability Engineering Work (RI1),Elaboration,AVA1099-9375,1099 RI1 Execution Epic,New,AVA1099-9375-1,Execution story,New,CDC-140,1099 CDC Production,Production,relates to
MNA-OOBJ,Oobj,Active,MNAC-53,Oobj | Reliability Engineering Work (RI1),New,RELEC-208,Oobj RELEC Active 1,Waiting,,,,,RELEC-164,Oobj RELEC Active 2,In Progress,is blocked by`;

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

function getMna(title = "") {
  return title.split("|")[0]?.trim() || "Unknown";
}

function pick(row, keys) {
  for (const key of keys) if (row[key]) return row[key];
  return "";
}

function getParentKey(row) {
  return pick(row, ["parent_key", "roadmap_key", "ri_key", "roadmap_item_key"]);
}

function getParentTitle(row) {
  return pick(row, ["parent_title", "roadmap_title", "ri_title", "roadmap_item_title"]);
}

function getParentStatus(row) {
  return pick(row, ["parent_status", "roadmap_status", "ri_status", "roadmap_item_status"]);
}

function getInitiative(row) {
  const title = pick(row, ["initiative_title", "initiative_name", "mna", "mna_name"]);
  return title || getMna(getParentTitle(row));
}

function getRI(title = "") {
  const match = title.match(/\((RI\d+)\)/i);
  return match ? match[1].toUpperCase() : "Unknown";
}

function statusTone(status = "") {
  const s = status.toLowerCase();
  if (["done", "closed", "resolved", "production"].some((x) => s.includes(x))) return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (["progress", "waiting", "blocked"].some((x) => s.includes(x))) return "bg-amber-100 text-amber-800 border-amber-200";
  if (["todo", "to do", "new", "elaboration", "ideation"].some((x) => s.includes(x))) return "bg-sky-100 text-sky-800 border-sky-200";
  if (s.includes("cancel")) return "bg-slate-100 text-slate-700 border-slate-200";
  return "bg-gray-100 text-gray-800 border-gray-200";
}

export default function MnaRiLinkedIssueDashboard() {
  const [csvText, setCsvText] = useState(SAMPLE_CSV);
  const [search, setSearch] = useState("");
  const [mnaFilter, setMnaFilter] = useState("all");
  const [riFilter, setRiFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [expanded, setExpanded] = useState({});
  const [viewMode, setViewMode] = useState("hierarchy");

  const rows = useMemo(() => parseCSV(csvText), [csvText]);

  const parents = useMemo(() => {
    const map = new Map();
    rows.forEach((r) => {
      const parentKey = getParentKey(r);
      const parentTitle = getParentTitle(r);
      if (!parentKey) return;
      if (!map.has(parentKey)) {
        map.set(parentKey, {
          parent_key: parentKey,
          parent_title: parentTitle,
          parent_status: getParentStatus(r),
          mna: getInitiative(r),
          ri: getRI(parentTitle),
          links: [],
        });
      }
      if (r.linked_key) map.get(parentKey).links.push(r);
    });
    return Array.from(map.values());
  }, [rows]);

  const hierarchy = useMemo(() => buildHierarchy(rows), [rows]);
  const toggle = (id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  const expandAll = () => {
    const all = {};
    hierarchy.forEach((i) => {
      all[i.id] = true;
      i.children.forEach((r) => {
        all[r.id] = true;
        r.children.forEach((e) => {
          all[e.id] = true;
          e.children.forEach((s) => (all[s.id] = true));
        });
      });
    });
    setExpanded(all);
  };
  const collapseAll = () => setExpanded({});

  const mnas = useMemo(() => Array.from(new Set(parents.map((p) => p.mna))).sort(), [parents]);
  const ris = ["RI1", "RI2", "RI3", "RI4", "RI5"];

  const filteredParents = useMemo(() => {
    return parents.filter((p) => {
      const q = search.toLowerCase();
      const searchable = `${p.parent_key} ${p.parent_title} ${p.parent_status} ${p.links.map((l) => `${l.linked_key} ${l.linked_title} ${l.linked_status} ${l.link_type}`).join(" ")}`.toLowerCase();
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
  }, [parents, search, mnaFilter, riFilter, riskFilter]);

  const metrics = useMemo(() => {
    const linkedRows = rows.filter((r) => r.linked_key).length;
    const zeroParents = parents.filter((p) => p.links.length === 0).length;
    const blockers = rows.filter((r) => (r.link_type || "").toLowerCase().includes("block")).length;
    const gaps = rows.filter((r) => /\[gap\]|gap/i.test(r.linked_title || "")).length;
    return { parents: parents.length, linkedRows, zeroParents, blockers, gaps, mnas: mnas.length };
  }, [rows, parents, mnas]);

  const mnaChart = useMemo(() => {
    return mnas.map((mna) => {
      const p = parents.filter((x) => x.mna === mna);
      return {
        name: mna,
        linked: p.reduce((sum, x) => sum + x.links.length, 0),
        parents: p.length,
        zero: p.filter((x) => x.links.length === 0).length,
      };
    });
  }, [parents, mnas]);

  const riChart = useMemo(() => {
    return ris.map((ri) => {
      const p = parents.filter((x) => x.ri === ri);
      return { name: ri, linked: p.reduce((sum, x) => sum + x.links.length, 0), zero: p.filter((x) => x.links.length === 0).length };
    });
  }, [parents]);

  const coverageData = [
    { name: "Parents with links", value: metrics.parents - metrics.zeroParents },
    { name: "Parents without links", value: metrics.zeroParents },
  ];

  const exportFiltered = () => {
    const header = "parent_key,parent_title,parent_status,linked_key,linked_title,linked_status,link_type";
    const out = [header];
    filteredParents.forEach((p) => {
      if (p.links.length === 0) {
        out.push([p.parent_key, p.parent_title, p.parent_status, "", "", "", ""].map(csvEscape).join(","));
      } else {
        p.links.forEach((l) => out.push([l.parent_key, l.parent_title, l.parent_status, l.linked_key, l.linked_title, l.linked_status, l.link_type].map(csvEscape).join(",")));
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

  return (
    <div className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white">
              <BarChart3 className="h-3.5 w-3.5" /> Leadership View
            </div>
            <h1 className="text-3xl font-bold tracking-tight">M&A Jira Hierarchy + Linked-Issue Dashboard</h1>
            <p className="mt-1 text-sm text-slate-600">Paste Jira CSV once. View Initiative → Roadmap Item → Epic → Story, plus linked issues, blockers, gaps, and zero-link records.</p>
          </div>
          <Button onClick={exportFiltered} className="gap-2 rounded-2xl shadow-sm">
            <Download className="h-4 w-4" /> Export Filtered CSV
          </Button>
        </div>

        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2 font-semibold"><Upload className="h-4 w-4" /> Paste CSV</div>
            <Textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} className="min-h-40 font-mono text-xs" placeholder="Paste CSV. Supported: initiative_key, initiative_title, initiative_status, roadmap_key, roadmap_title, roadmap_status, epic_key, epic_title, epic_status, story_key, story_title, story_status, linked_key, linked_title, linked_status, link_type. Legacy parent_* CSV also works." />
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
          <Metric title="M&As" value={metrics.mnas} icon={<CircleCheck />} />
          <Metric title="RI / Roadmap Items" value={metrics.parents} icon={<CircleDashed />} />
          <Metric title="Linked Issues" value={metrics.linkedRows} icon={<Link2 />} />
          <Metric title="No-Link Parents" value={metrics.zeroParents} icon={<AlertTriangle />} warn />
          <Metric title="Blockers" value={metrics.blockers} icon={<AlertTriangle />} warn />
          <Metric title="Gaps" value={metrics.gaps} icon={<Search />} />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="rounded-2xl border-slate-200 shadow-sm lg:col-span-2">
            <CardContent className="p-4">
              <h2 className="mb-4 font-semibold">Linked Issues by M&A</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={mnaChart} margin={{ top: 8, right: 12, left: 0, bottom: 48 }}>
                    <XAxis dataKey="name" angle={-35} textAnchor="end" interval={0} height={70} fontSize={11} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="linked" name="Linked Issues" radius={[8, 8, 0, 0]} />
                    <Bar dataKey="zero" name="Zero-Link Parents" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-slate-200 shadow-sm">
            <CardContent className="p-4">
              <h2 className="mb-4 font-semibold">Parent Coverage</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={coverageData} dataKey="value" nameKey="name" outerRadius={90} label>
                      <Cell />
                      <Cell />
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
            <h2 className="mb-4 font-semibold">RI Coverage View</h2>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={riChart}>
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="linked" name="Linked Issues" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="zero" name="Zero-Link Parents" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="font-semibold">Detailed View</h2>
                <p className="text-xs text-slate-500">Switch between expandable hierarchy and flat linked-issue table.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant={viewMode === "hierarchy" ? "default" : "outline"} size="sm" onClick={() => setViewMode("hierarchy")} className="gap-2"><ChevronRight className="h-4 w-4" /> Hierarchy</Button>
                <Button variant={viewMode === "flat" ? "default" : "outline"} size="sm" onClick={() => setViewMode("flat")}>Flat Links</Button>
                {viewMode === "hierarchy" && <><Button variant="outline" size="sm" onClick={expandAll}>Expand All</Button><Button variant="outline" size="sm" onClick={collapseAll}>Collapse All</Button></>}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <div className="relative md:col-span-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search key/title/status" className="pl-9" />
              </div>
              <Select value={mnaFilter} onValueChange={setMnaFilter}>
                <SelectTrigger><SelectValue placeholder="M&A" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All M&As</SelectItem>
                  {mnas.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={riFilter} onValueChange={setRiFilter}>
                <SelectTrigger><SelectValue placeholder="RI" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All RIs</SelectItem>
                  {ris.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={riskFilter} onValueChange={setRiskFilter}>
                <SelectTrigger><SelectValue placeholder="Risk" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Records</SelectItem>
                  <SelectItem value="blocked">Blockers Only</SelectItem>
                  <SelectItem value="gap">Gaps Only</SelectItem>
                  <SelectItem value="zero">No Linked Issues</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {viewMode === "hierarchy" ? (
              <HierarchyView hierarchy={hierarchy} expanded={expanded} toggle={toggle} search={search} mnaFilter={mnaFilter} riFilter={riFilter} riskFilter={riskFilter} />
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
                      if (p.links.length === 0) return <ParentRow key={p.parent_key} p={p} link={null} />;
                      return p.links.map((l, idx) => <ParentRow key={`${p.parent_key}-${l.linked_key}-${idx}`} p={p} link={l} showParent={idx === 0} rowSpan={p.links.length} />);
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function buildHierarchy(rows) {
  const initiatives = new Map();
  rows.forEach((r, idx) => {
    const initiativeKey = pick(r, ["initiative_key", "mna_key"]) || getInitiative(r) || "Unknown Initiative";
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

    if (!initiatives.has(initiativeKey)) initiatives.set(initiativeKey, makeNode("initiative", initiativeKey, initiativeTitle, initiativeStatus));
    const initiative = initiatives.get(initiativeKey);
    const roadmap = getOrCreateChild(initiative, "roadmap", roadmapKey, roadmapTitle, roadmapStatus);
    let attachNode = roadmap;
    if (epicKey) attachNode = getOrCreateChild(roadmap, "epic", epicKey, epicTitle || epicKey, epicStatus);
    if (storyKey) attachNode = getOrCreateChild(attachNode, "story", storyKey, storyTitle || storyKey, storyStatus);
    if (r.linked_key) attachNode.links.push(r);
  });
  return Array.from(initiatives.values());
}

function makeNode(type, key, title, status) {
  return { id: `${type}:${key}`, type, key, title, status, children: [], links: [] };
}

function getOrCreateChild(parent, type, key, title, status) {
  let node = parent.children.find((c) => c.type === type && c.key === key);
  if (!node) {
    node = makeNode(type, key, title, status);
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
  if (riskFilter === "blocked") return allLinks.some((l) => (l.link_type || "").toLowerCase().includes("block"));
  if (riskFilter === "gap") return allLinks.some((l) => /\[gap\]|gap/i.test(l.linked_title || ""));
  if (riskFilter === "zero") return allLinks.length === 0;
  return true;
}

function nodeMatches(node, search, mnaFilter, riFilter, riskFilter) {
  const q = search.toLowerCase();
  const text = `${node.key} ${node.title} ${node.status} ${collectLinks(node).map((l) => `${l.linked_key} ${l.linked_title} ${l.linked_status} ${l.link_type}`).join(" ")}`.toLowerCase();
  const searchOk = !q || text.includes(q);
  const mnaOk = mnaFilter === "all" || node.title === mnaFilter || text.includes(mnaFilter.toLowerCase());
  const riOk = riFilter === "all" || text.includes(riFilter.toLowerCase());
  return searchOk && mnaOk && riOk && nodeHasRisk(node, riskFilter);
}

function HierarchyView({ hierarchy, expanded, toggle, search, mnaFilter, riFilter, riskFilter }) {
  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
      {hierarchy.filter((n) => nodeMatches(n, search, mnaFilter, riFilter, riskFilter)).map((node) => (
        <TreeNode key={node.id} node={node} depth={0} expanded={expanded} toggle={toggle} search={search} mnaFilter={mnaFilter} riFilter={riFilter} riskFilter={riskFilter} />
      ))}
    </div>
  );
}

function TreeNode({ node, depth, expanded, toggle, search, mnaFilter, riFilter, riskFilter }) {
  const isOpen = !!expanded[node.id];
  const visibleChildren = node.children.filter((n) => nodeMatches(n, search, mnaFilter, riFilter, riskFilter));
  const links = collectLinks(node);
  const directLinks = node.links;
  const hasKids = visibleChildren.length > 0 || directLinks.length > 0;
  const typeLabel = { initiative: "Initiative", roadmap: "Roadmap Item", epic: "Epic", story: "Story" }[node.type] || node.type;
  return (
    <div>
      <div className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50" style={{ paddingLeft: `${depth * 24 + 8}px` }}>
        <button onClick={() => toggle(node.id)} className="rounded p-1 hover:bg-slate-100" disabled={!hasKids}>
          {hasKids ? (isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : <span className="inline-block h-4 w-4" />}
        </button>
        <Badge variant="outline">{typeLabel}</Badge>
        <div className="min-w-28 font-semibold">{node.key}</div>
        <div className="flex-1 text-slate-700">{node.title}</div>
        {node.status && <Badge className={`${statusTone(node.status)} border`}>{node.status}</Badge>}
        <Badge variant={links.length ? "secondary" : "outline"}>{links.length} links</Badge>
        {links.some((l) => (l.link_type || "").toLowerCase().includes("block")) && <Badge variant="destructive">blocked</Badge>}
      </div>
      {isOpen && directLinks.length > 0 && (
        <div className="ml-12 mr-2 overflow-hidden rounded-xl border border-slate-100 bg-slate-50">
          {directLinks.map((l, idx) => (
            <div key={`${node.id}-${l.linked_key}-${idx}`} className="grid grid-cols-12 gap-2 border-t border-slate-100 p-2 text-xs first:border-t-0">
              <div className="col-span-2 font-semibold">{l.linked_key}</div>
              <div className="col-span-6">{l.linked_title}</div>
              <div className="col-span-2"><Badge className={`${statusTone(l.linked_status)} border`}>{l.linked_status || "Unknown"}</Badge></div>
              <div className="col-span-2"><Badge variant={(l.link_type || "").toLowerCase().includes("block") ? "destructive" : "secondary"}>{l.link_type}</Badge></div>
            </div>
          ))}
        </div>
      )}
      {isOpen && visibleChildren.map((child) => <TreeNode key={child.id} node={child} depth={depth + 1} expanded={expanded} toggle={toggle} search={search} mnaFilter={mnaFilter} riFilter={riFilter} riskFilter={riskFilter} />)}
    </div>
  );
}

function Metric({ title, value, icon, warn }) {
  return (
    <Card className="rounded-2xl border-slate-200 shadow-sm">
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</div>
          <div className="mt-1 text-2xl font-bold">{value}</div>
        </div>
        <div className={`rounded-2xl p-2 ${warn ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700"}`}>{React.cloneElement(icon, { className: "h-5 w-5" })}</div>
      </CardContent>
    </Card>
  );
}

function ParentRow({ p, link, showParent = true, rowSpan = 1 }) {
  return (
    <tr className="border-t border-slate-100 align-top hover:bg-slate-50">
      {showParent && (
        <td className="p-3" rowSpan={rowSpan}>
          <div className="font-semibold text-slate-900">{p.parent_key}</div>
          <div className="max-w-md text-slate-700">{p.parent_title}</div>
          <div className="mt-1 flex gap-1"><Badge variant="outline">{p.mna}</Badge><Badge variant="outline">{p.ri}</Badge></div>
        </td>
      )}
      {showParent && (
        <td className="p-3" rowSpan={rowSpan}>
          <Badge className={`${statusTone(p.parent_status)} border`}>{p.parent_status || "Unknown"}</Badge>
        </td>
      )}
      <td className="p-3">
        {link ? <><div className="font-semibold">{link.linked_key}</div><div className="max-w-xl text-slate-700">{link.linked_title}</div></> : <span className="font-medium text-amber-700">No linked issues</span>}
      </td>
      <td className="p-3">{link ? <Badge className={`${statusTone(link.linked_status)} border`}>{link.linked_status || "Unknown"}</Badge> : ""}</td>
      <td className="p-3">{link ? <Badge variant={(link.link_type || "").toLowerCase().includes("block") ? "destructive" : "secondary"}>{link.link_type}</Badge> : ""}</td>
    </tr>
  );
}
