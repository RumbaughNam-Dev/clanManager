import React from "react";

export default function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl shadow p-4 bg-white ${className}`}>{children}</div>;
}
