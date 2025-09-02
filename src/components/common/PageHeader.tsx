import React from "react";

export default function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between pb-4 border-b">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm opacity-70 mt-1">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
