// src/components/common/Pill.tsx
type PillTone = "default" | "success" | "warning" | "danger";

type PillProps = {
  children: React.ReactNode;
  tone?: PillTone;
  className?: string;
};

export default function Pill({ children, tone = "default", className = "" }: PillProps) {
  const toneClass =
    tone === "success" ? "bg-emerald-100 text-emerald-800" :
    tone === "warning" ? "bg-amber-100 text-amber-800" :
    tone === "danger"  ? "bg-rose-100 text-rose-800" :
                         "bg-slate-100 text-slate-800";

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded ${toneClass} ${className}`}>
      {children}
    </span>
  );
}