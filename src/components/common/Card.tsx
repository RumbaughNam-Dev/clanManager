import React from "react";

export default function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/5 text-white/80 shadow-sm p-4 ${className}`}>
      {children}
    </div>
  );
}
