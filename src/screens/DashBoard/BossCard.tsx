import type { BossDto } from "../../types";

type Props = {
  b: BossDto;
  onQuickCut: (b: BossDto) => void;
  onDaze?: (b: BossDto) => void;
  extraNextLabel?: string;

  // ⬇️ 추가
  nextTextOverride?: string;

  showCount?: "daze" | "miss";
  dazeCount?: number;
  missCount?: number;
};

export default function BossCard({
  b,
  onQuickCut,
  onDaze,
  extraNextLabel,
  // ⬇️ 추가
  nextTextOverride,
  showCount,
  dazeCount = 0,
  missCount = 0,
}: Props) {
  const fmt = (s?: string | null) => {
    if (!s) return "—";
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleString("ko-KR", { hour12: false });
  };


  // 우측 상단의 작은 카운트 배지 (카드 안에 표시)
  const countBadge =
    showCount === "daze" ? (
      <span className="ml-2 inline-block px-2 py-0.5 rounded-md text-[11px] font-medium bg-amber-500/10 text-amber-700 border border-amber-200">
        멍 {dazeCount}
      </span>
    ) : showCount === "miss" ? (
      <span className="ml-2 inline-block px-2 py-0.5 rounded-md text-[11px] font-medium bg-sky-500/10 text-sky-700 border border-sky-200">
        미입력 {missCount}
      </span>
    ) : null;

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
      {/* 헤더: 이름 / 위치 / (카운트 배지) */}
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <span className="font-medium">{b.name}</span>
          {countBadge}
        </div>
        <span className="text-xs text-slate-500">{b.location}</span>
      </div>

      {/* 메타 정보 */}
      <div className="text-xs text-slate-600">
        마지막 컷: <span className="font-medium">{fmt(b.lastCutAt)}</span>
      </div>

      <div className="text-xs text-slate-600">
        {extraNextLabel ?? "다음 젠"}:{" "}
        {/* ⬇️ 오버라이드가 있으면 그대로, 없으면 기존 포맷 */}
        <span className="font-medium">{nextTextOverride ?? fmt(b.nextSpawnAt)}</span>
      </div>

      {/* 기존 간격 유지 */}
      <div className="mt-4" />

      {/* 하단 바: 왼쪽 끝 = 멍 여부 / 오른쪽 = 버튼들 */}
      <div className="flex items-center justify-between">
        {/* 왼쪽 끝 */}
        {dazeIndicator}

        {/* 오른쪽 버튼들 (기존 간격 유지) */}
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
