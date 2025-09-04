// src/screens/dashboard/LoggedInDashboard.tsx
import { useState, useEffect, useMemo } from "react";
import { postJSON } from "@/lib/http";
import BossCard from "./BossCard";
import ForgottenCard from "./ForgottenCard";
import CutModal from "./CutModal";
import type { BossDto, ListBossesResp } from "../../types";
import { formatNow } from "../../utils/util";

export default function LoggedInDashboard() {
  // 서버에서 분류되어 오는 리스트(기본)
  const [trackedRaw, setTrackedRaw] = useState<BossDto[]>([]);
  const [forgottenRaw, setForgottenRaw] = useState<BossDto[]>([]);
  const [loading, setLoading] = useState(true);

  // 검색어 (좌/중 섹션 동시 필터)
  const [query, setQuery] = useState("");

  // 모달
  const [cutOpen, setCutOpen] = useState(false);
  const [selectedBoss, setSelectedBoss] = useState<BossDto | null>(null);

  // 주기적으로 재정렬(예상 젠 시간이 흘러가면서 순서가 바뀌어야 함)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // 최초 로드 + 1분마다 갱신
  useEffect(() => {
    loadBosses();
    const t = setInterval(() => loadBosses(), 60_000);
    return () => clearInterval(t);
  }, []);

  async function loadBosses() {
    setLoading(true);
    try {
      const data = await postJSON<ListBossesResp>("/v1/dashboard/bosses");
      setTrackedRaw(data.tracked ?? []);
      setForgottenRaw(data.forgotten ?? []);
    } catch {
      setTrackedRaw([]);
      setForgottenRaw([]);
    } finally {
      setLoading(false);
    }
  }

  // 정렬 규칙
  const { trackedSorted, forgottenSorted } = useMemo(() => {
    const now = Date.now();

    const safeTime = (iso?: string | null) =>
      iso ? new Date(iso).getTime() : Number.POSITIVE_INFINITY;

    const trackedSorted = [...trackedRaw].sort(
      (a, b) => safeTime(a.nextSpawnAt) - safeTime(b.nextSpawnAt)
    );

    const forgottenWithPredicted = forgottenRaw.map((b) => {
      if (!b.lastCutAt || !b.respawn || b.respawn <= 0) {
        return { b, predicted: Number.POSITIVE_INFINITY };
      }
      const lastMs = new Date(b.lastCutAt).getTime();
      if (isNaN(lastMs)) {
        return { b, predicted: Number.POSITIVE_INFINITY };
      }
      const respawnMs = Math.round(b.respawn * 60 * 1000);
      const diff = now - lastMs;
      const k = Math.max(1, Math.ceil(diff / respawnMs));
      const nextMs = lastMs + k * respawnMs;
      return { b, predicted: nextMs };
    });

    const forgottenSorted = forgottenWithPredicted
      .sort((x, y) => x.predicted - y.predicted)
      .map(({ b }) => b);

    return { trackedSorted, forgottenSorted };
  }, [trackedRaw, forgottenRaw, tick]);

  // 검색(스크립트로만) — 이름/위치 모두 매칭, 공백으로 나눈 모든 토큰 포함(AND)
  const { trackedFiltered, forgottenFiltered } = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { trackedFiltered: trackedSorted, forgottenFiltered: forgottenSorted };

    const tokens = q.split(/\s+/g);

    const match = (b: BossDto) => {
      const hay = `${b.name} ${b.location ?? ""}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    };

    return {
      trackedFiltered: trackedSorted.filter(match),
      forgottenFiltered: forgottenSorted.filter(match),
    };
  }, [query, trackedSorted, forgottenSorted]);

  const handleCut = (b: BossDto) => {
    setSelectedBoss(b);
    setCutOpen(true);
  };

  return (
    <div className="grid grid-rows-[auto_1fr] gap-3 h-[calc(100vh-56px)]">
      {/* 검색 바 */}
      <div className="flex items-center gap-2">
        <div className="relative w-full max-w-xl">
          <input
            className="w-full border rounded-xl px-4 py-2 pr-10"
            placeholder="보스 이름 또는 위치로 검색 (예: 오만6층, 안타, 엘모어)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              onClick={() => setQuery("")}
              aria-label="검색어 지우기"
              title="지우기"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* 본문 그리드 */}
      <div className="grid grid-cols-3 gap-4 min-h-0">
        {/* 1) 좌측: 진행중 보스타임 (임박 순) */}
        <section className="col-span-1 min-h-0 overflow-y-auto px-1">
          <h2 className="text-base font-semibold mb-2 text-slate-700">
            진행중 보스타임
            {query ? (
              <span className="ml-2 text-xs text-slate-400">
                (검색결과 {trackedFiltered.length}개)
              </span>
            ) : null}
          </h2>
          <div className="space-y-2">
            {loading ? (
              <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-500">
                불러오는 중…
              </div>
            ) : trackedFiltered.length === 0 ? (
              <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-400 italic">
                {query ? "검색 결과가 없습니다." : "스케줄 추적 중인 보스가 없습니다."}
              </div>
            ) : (
              trackedFiltered.map((b) => <BossCard key={b.id} b={b} onCut={handleCut} />)
            )}
          </div>
        </section>

        {/* 2) 가운데: 잊어버린 보스타임 (예상 젠 임박 순) */}
        <section className="col-span-1 min-h-0 overflow-y-auto px-1">
          <h2 className="text-base font-semibold mb-2 text-slate-700">
            잊어버린 보스타임
            {query ? (
              <span className="ml-2 text-xs text-slate-400">
                (검색결과 {forgottenFiltered.length}개)
              </span>
            ) : null}
          </h2>
          <div className="space-y-2">
            {loading ? (
              <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-500">
                불러오는 중…
              </div>
            ) : forgottenFiltered.length === 0 ? (
              <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-400 italic">
                {query ? "검색 결과가 없습니다." : "잊어버린 보스가 없습니다."}
              </div>
            ) : (
              forgottenFiltered.map((b) => (
                <ForgottenCard key={b.id} b={b} onCut={handleCut} extraNextLabel="예상 다음 젠" />
              ))
            )}
          </div>
        </section>

        {/* 3) 우측: 비워둠 */}
        <section className="col-span-1 h-full px-1">
          <h2 className="text-base font-semibold mb-2 text-slate-700">비워둠</h2>
          <div className="h-full rounded-xl border-dashed border-2 border-slate-200 flex items-center justify-center text-slate-400">
            추후 위젯/요약 영역
          </div>
        </section>
      </div>

      {/* 컷 입력 모달 */}
      <CutModal
        open={cutOpen}
        boss={selectedBoss}
        onClose={() => setCutOpen(false)}
        onSaved={async () => {
          setCutOpen(false);
          setSelectedBoss(null);
          await loadBosses();
        }}
        defaultCutAt={formatNow()}
      />
    </div>
  );
}