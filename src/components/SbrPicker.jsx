import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown, Search, Loader2, RefreshCw } from "lucide-react";

const AV_ORANGE = "#F37021";
const AV_NAVY  = "#1E3A5F";

export default function SbrPicker({ value, onChange, onLoad }) {
  const [open, setOpen]         = useState(false);
  const [query, setQuery]       = useState("");
  const [sbrs, setSbrs]         = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [fetched, setFetched]   = useState(false);
  const containerRef            = useRef(null);
  const inputRef                = useRef(null);

  const loadSbrs = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = force ? "/api/sbr-list?refresh=true" : "/api/sbr-list";
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSbrs(data.sbrs || []);
      setFetched(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on first open
  useEffect(() => {
    if (open && !fetched) loadSbrs();
  }, [open, fetched, loadSbrs]);

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Focus search input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const filtered = sbrs.filter((s) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return s.key.toLowerCase().includes(q) || s.summary.toLowerCase().includes(q);
  });

  function select(sbr) {
    onChange(sbr.key);
    setOpen(false);
    setQuery("");
    onLoad?.(sbr.key);
  }

  function handleManualKey(e) {
    if (e.key === "Enter" && query.trim().toUpperCase().startsWith("SBR-")) {
      const key = query.trim().toUpperCase();
      onChange(key);
      setOpen(false);
      setQuery("");
      onLoad?.(key);
    }
  }

  const selectedSbr = sbrs.find((s) => s.key === value);

  return (
    <div ref={containerRef} className="relative" style={{ minWidth: 280 }}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-mono shadow-sm hover:border-slate-400 focus:outline-none focus:ring-2 transition w-full"
        style={{ "--tw-ring-color": AV_ORANGE }}
      >
        <span className="flex-1 text-left truncate" style={{ color: value ? AV_NAVY : "#94a3b8" }}>
          {value
            ? selectedSbr
              ? `${value} · ${selectedSbr.summary.slice(0, 40)}${selectedSbr.summary.length > 40 ? "…" : ""}`
              : value
            : "Select or search SBR…"}
        </span>
        <ChevronDown className={`h-4 w-4 text-slate-400 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden"
             style={{ minWidth: 360 }}>

          {/* Search bar */}
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <Search className="h-4 w-4 text-slate-400 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value.toUpperCase())}
              onKeyDown={handleManualKey}
              placeholder="Search by key or name… or type SBR-xxx ↵"
              className="flex-1 text-sm focus:outline-none bg-transparent font-mono"
            />
            {loading
              ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
              : <button type="button" onClick={() => loadSbrs(true)} title="Refresh list"
                  className="text-slate-400 hover:text-slate-600">
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
            }
          </div>

          {/* List */}
          <ul className="max-h-72 overflow-y-auto">
            {error && (
              <li className="px-4 py-3 text-sm text-red-500">Failed to load: {error}</li>
            )}
            {!error && !loading && filtered.length === 0 && (
              <li className="px-4 py-3 text-sm text-slate-400 italic">
                {query ? `No SBR matching "${query}" — press Enter to load it directly` : "No active SBRs found"}
              </li>
            )}
            {filtered.map((sbr) => (
              <li key={sbr.key}>
                <button
                  type="button"
                  onClick={() => select(sbr)}
                  className={`w-full text-left px-4 py-2.5 hover:bg-orange-50 flex items-start gap-3 transition ${
                    sbr.key === value ? "bg-orange-50" : ""
                  }`}
                >
                  <span
                    className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-bold font-mono text-white"
                    style={{ background: AV_NAVY }}
                  >
                    {sbr.key}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-slate-800 truncate">{sbr.summary}</span>
                    <span className="block text-xs text-slate-400">{sbr.status}</span>
                  </span>
                  {sbr.key === value && (
                    <span className="text-xs font-semibold shrink-0" style={{ color: AV_ORANGE }}>active</span>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {fetched && (
            <div className="border-t border-slate-100 px-3 py-1.5 text-xs text-slate-400 text-right">
              {filtered.length} of {sbrs.length} active SBRs
            </div>
          )}
        </div>
      )}
    </div>
  );
}
