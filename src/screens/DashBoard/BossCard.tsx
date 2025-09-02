// src/screens/dashboard/BossCard.tsx
import type { BossDto } from "../../types";

type Props = {
  b: BossDto;
  onCut: (b: BossDto) => void;
  /** 목록에 표시할 "다음 젠" 라벨을 바꾸고 싶을 때 사용 (예: "예상 다음 젠") */
  extraNextLabel?: string;
};

export default function BossCard({ b, onCut, extraNextLabel }: Props) {
  const fmt = (s?: string | null) => {
    if (!s) return "—";
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleString("ko-KR", { hour12: false });
  };

  return (
    <div
      className={`rounded-xl border shadow-sm p-3 text-sm flex flex-col gap-1 ${
        b.overdue ? "bg-rose-50 border-rose-200" : "bg-white"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium">{b.name}</span>
        <span className="text-xs text-slate-500">{b.location}</span>
      </div>

      <div className="text-xs text-slate-600">
        마지막 컷: <span className="font-medium">{fmt(b.lastCutAt)}</span>
      </div>

      <div className="text-xs text-slate-600">
        {extraNextLabel ?? "다음 젠"}:{" "}
        <span className="font-medium">{fmt(b.nextSpawnAt)}</span>
      </div>

      {/* ⬇️ 하단에 설명 + 버튼 배치 */}
      <div className="pt-2 flex items-center justify-between">
        <span className="text-[11px] text-slate-500">
          {b.isRandom ? "멍 있을 수 있음" : "멍 없는 보스"}
        </span>
        <button
          className="px-3 py-1.5 text-xs rounded-lg border hover:bg-slate-50"
          onClick={() => onCut(b)}
        >
          보스 컷
        </button>
      </div>
    </div>
  );
}