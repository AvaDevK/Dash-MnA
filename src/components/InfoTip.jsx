import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";

const placementClass = {
  right: "right-0 top-7",
  left: "left-0 top-7",
  top: "right-0 bottom-7",
  bottom: "left-0 top-7",
};

export default function InfoTip({
  children,
  title,
  label = "What does this mean?",
  side = "right",
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onDocMouseDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onEsc(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  const placement = placementClass[side] || placementClass.right;

  return (
    <span ref={ref} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-400"
      >
        <Info className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="tooltip"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          className={`pointer-events-auto absolute z-50 w-72 rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-700 shadow-xl ${placement}`}
        >
          {title && <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</div>}
          {children}
        </div>
      )}
    </span>
  );
}
