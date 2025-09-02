export function formatNow() {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function toIsoFromLocal(s: string) {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return new Date(s).toISOString();
  const [_, Y, M, D, h, m2, s2] = m;
  const d = new Date(+Y, +M - 1, +D, +h, +m2, +s2);
  return d.toISOString();
}

export function roleLabel(r?: string | null) {
  switch (r) {
    case "SUPERADMIN": return "운영자";
    case "ADMIN": return "관리자";
    case "LEADER": return "간부";
    case "USER": return "혈맹원";
    default: return r ?? "";
  }
}