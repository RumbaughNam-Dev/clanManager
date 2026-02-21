// src/components/common/Pill.tsx
type PillTone = "default" | "success" | "warning" | "danger";

type PillProps = {
  children: React.ReactNode;
  tone?: PillTone;
  className?: string;
};

export default function Pill({ children, tone = "default", className = "" }: PillProps) {
  const toneClass =
    tone === "success" ? "bg-emerald-500/20 text-emerald-200 border border-emerald-400/30" :
    tone === "warning" ? "bg-amber-500/20 text-amber-200 border border-amber-400/30" :
    tone === "danger"  ? "bg-rose-500/20 text-rose-200 border border-rose-400/30" :
                         "bg-white/10 text-white/70 border border-white/10";

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded ${toneClass} ${className}`}>
      {children}
    </span>
  );
}
