import type { BossDto } from "../../types";

type Props = {
  b: BossDto;
  onQuickCut: (b: BossDto) => void;
  /** 중앙 섹션에서는 안 넘기면 멍 버튼이 숨겨짐 */
  onDaze?: (b: BossDto) => void;

  /** 카드 하단 배지에 표시할 카운트 종류 */
  showCount?: "daze" | "miss";
  /** showCount === 'daze' 일 때 사용 */
  dazeCount?: number;
  /** showCount === 'miss' 일 때 사용 */
  missCount?: number;

  /** 라벨 변경용(옵션) */
  extraNextLabel?: string;
};

export default function BossCard({
  b,
  onQuickCut,
  onDaze,
  showCount,
  dazeCount = 0,
  missCount = 0,
  extraNextLabel,
}: Props) {
  const fmt = (s?: string | null) => {
    if (!s) return "—";
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleString("ko-KR", { hour12: false });
  };

  const countPill =
    showCount === "daze" ? (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-slate-100 text-slate-700 border border-slate-200">
        멍 <b className="text-slate-900">{dazeCount}</b>회
      </span>
    ) : showCount === "miss" ? (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-amber-50 text-amber-700 border border-amber-200">
        미입력 <b className="text-amber-900">{missCount}</b>회
      </span>
    ) : null;

  return (
    <div className="relative rounded-xl border shadow-sm p-3 pb-10 text-sm flex flex-col gap-1 bg-white">
      <div className="flex items-center justify-between">
        <span className="font-medium">{b.name}</span>
        <span className="text-xs text-slate-500">{b.location}</span>
      </div>

      <div className="text-xs text-slate-600">
        마지막 컷: <span className="font-medium">{fmt(b.lastCutAt)}</span>
      </div>

      <div className="text-xs text-slate-600">
        {extraNextLabel ?? "다음 젠"}: <span className="font-medium">{fmt(b.nextSpawnAt)}</span>
      </div>

      {/* 카드 내부 우하단: 카운트 배지 + 버튼들 */}
      <div className="absolute right-3 bottom-3 flex items-center gap-2">
        {countPill}
        <button
          type="button"
          onClick={() => onQuickCut(b)}
          className="px-3 py-1.5 rounded-md text-xs text-white bg-slate-900 hover:opacity-90"
          title="지금 시간으로 즉시 컷"
        >
          컷
        </button>
        {onDaze && (
          <button
            type="button"
            onClick={() => onDaze(b)}
            className="px-3 py-1.5 rounded-md text-xs border text-slate-700 hover:bg-slate-50"
            title="멍 +1 (이번 타임 보스가 안 떴을 때)"
          >
            멍
          </button>
        )}
      </div>
    </div>
  );
}
