import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

export default function InfoTip({
  children,
  title,
  label = "What does this mean?",
  side = "right",
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const tipRef = useRef(null);

  useEffect(() => {
    function onDocMouseDown(e) {
      if (
        btnRef.current && !btnRef.current.contains(e.target) &&
        tipRef.current && !tipRef.current.contains(e.target)
      ) setOpen(false);
    }
    function onEsc(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  function computePos() {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const TIP_W = 320;
    const OFFSET = 8;
    let left, top;
    if (side === "left") {
      left = Math.max(8, r.left - TIP_W - OFFSET);
    } else {
      left = r.right + OFFSET;
      if (left + TIP_W > window.innerWidth - 8) left = r.left - TIP_W - OFFSET;
    }
    top = r.bottom + OFFSET;
    if (top + 200 > window.innerHeight - 8) top = r.top - 200 - OFFSET;
    setPos({ top: top + window.scrollY, left: Math.max(8, left) });
  }

  function show() { computePos(); setOpen(true); }
  function hide() { setOpen(false); }

  const tooltip = open ? createPortal(
    <div
      ref={tipRef}
      role="tooltip"
      onMouseEnter={show}
      onMouseLeave={hide}
      style={{ position: "absolute", top: pos.top, left: pos.left, width: 320, zIndex: 9999 }}
      className="rounded-xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-700 shadow-2xl"
    >
      {title && (
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </div>
      )}
      {children}
    </div>,
    document.body
  ) : null;

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); open ? hide() : show(); }}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-400"
      >
        <Info className="h-4 w-4" />
      </button>
      {tooltip}
    </span>
  );
}
