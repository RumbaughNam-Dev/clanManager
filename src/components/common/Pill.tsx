export default function Pill({ children, tone = "default" as "default" | "success" | "warning" | "danger" }) {
  const map = {
    default: "bg-gray-100 text-gray-700",
    success: "bg-green-100 text-green-700",
    warning: "bg-amber-100 text-amber-700",
    danger: "bg-red-100 text-red-700",
  } as const;
  return <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full ${map[tone]}`}>{children}</span>;
}
