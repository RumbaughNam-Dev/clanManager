import type { BossDto } from "../../types";

type Props = {
  b: BossDto;
  onQuickCut: (b: BossDto) => void;
  onDaze?: (b: BossDto) => void;
  extraNextLabel?: string;

  // ⬇️ 추가
  nextTextOverride?: string;

  // 미입력 리스트에서만 사용할 옵션 (해당 리스트에서만 showCount="miss"로 넘겨주세요)
  showCount?: "daze" | "miss";
  dazeCount?: number; // 넘기지 않으면 b.dazeCount 사용
  missCount?: number;
};

export default function BossCard({
  b,
  onQuickCut,
  onDaze,
  extraNextLabel,
  nextTextOverride,
  showCount,
  dazeCount,
  missCount = 0,
}: Props) {
  const fmt = (s?: string | null) => {
    if (!s) return "—";
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleString("ko-KR", { hour12: false });
  };

  // BossDto.dazeCount가 서버에서 오므로, prop이 없으면 그 값을 사용
  const effectiveDaze = Number.isFinite(dazeCount as number)
    ? (dazeCount as number)
    : (b as any)?.dazeCount ?? 0;

  // 하단 왼쪽 끝 “멍 가능/멍 없음” 인디케이터
  const dazeIndicator = (
    <span
      className={
        "inline-block px-2 py-0.5 rounded-md text-[11px] font-medium border " +
        (onDaze
          ? "bg-emerald-500/10 text-emerald-700 border-emerald-200"
          : "bg-slate-100 text-slate-500 border-slate-200")
      }
    >
      {onDaze ? "멍 가능" : "멍 없음"}
    </span>
  );

  return (
    <div
      className={`relative rounded-xl border shadow-sm p-3 text-sm flex flex-col gap-2 ${
        b.overdue ? "bg-rose-50 border-rose-200" : "bg-white"
      }`}
    >
      {/* 좌측 상단: 멍 카운트 (멍 1회 이상일 때만) */}
      {effectiveDaze > 0 && (
        <div
          className="absolute top-2 left-2 z-10 rounded-md border border-amber-200 bg-amber-50/80 backdrop-blur px-2 py-0.5 text-[11px] font-medium text-amber-700 shadow-sm"
          role="status"
          aria-live="polite"
          aria-label={`멍 ${effectiveDaze}회`}
        >
          멍 {effectiveDaze}
        </div>
      )}

      {/* 우측 상단: 미입력 카운트 (미입력 리스트에서만 showCount='miss'로 전달 시 노출) */}
      {showCount === "miss" && missCount > 0 && (
        <div
          className="absolute top-2 right-2 z-10 rounded-md border border-sky-200 bg-sky-50/80 backdrop-blur px-2 py-0.5 text-[11px] font-medium text-sky-700 shadow-sm"
          role="status"
          aria-live="polite"
          aria-label={`미입력 ${missCount}회`}
        >
          미입력 {missCount}
        </div>
      )}

      {/* 헤더: 이름 / 위치 */}
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <span className="font-medium truncate block">{b.name}</span>
        </div>
        <span className="text-xs text-slate-500 truncate max-w-[50%] text-right">
          {b.location}
        </span>
      </div>

      {/* 메타 정보 */}
      <div className="text-xs text-slate-600">
        마지막 컷: <span className="font-medium">{fmt(b.lastCutAt)}</span>
      </div>

      <div className="text-xs text-slate-600">
        {extraNextLabel ?? "다음 젠"}:{" "}
        <span className="font-medium">{nextTextOverride ?? fmt(b.nextSpawnAt)}</span>
      </div>

      {/* 버튼 영역과 간격 확보 */}
      <div className="mt-4" />

      {/* 하단 바: 왼쪽 끝 = 멍 여부 / 오른쪽 = 버튼들 */}
      <div className="flex items-center justify-between">
        {dazeIndicator}

        <div className="flex items-center gap-2 pr-1">
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
    </div>
  );
}
