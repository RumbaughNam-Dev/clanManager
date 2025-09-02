// src/screens/dashboard/LoggedInDashboard.tsx
import React, { useEffect, useMemo, useState } from "react";
import { getJSON } from "../../lib/http";
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

  // 모달
  const [cutOpen, setCutOpen] = useState(false);
  const [selectedBoss, setSelectedBoss] = useState<BossDto | null>(null);

  // 주기적으로 재정렬(예상 젠 시간이 흘러가면서 순서가 바뀌어야 함)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // 최초 로드
  useEffect(() => {
    loadBosses();

    // ✅ 이후 1분마다 반복 실행
    const t = setInterval(() => {
      loadBosses();
    }, 60_000);

    return () => clearInterval(t);
  }, []);

  async function loadBosses() {
    setLoading(true);
    try {
      const data = await getJSON<ListBossesResp>("/v1/dashboard/bosses");
      setTrackedRaw(data.tracked ?? []);
      setForgottenRaw(data.forgotten ?? []);
    } catch {
      setTrackedRaw([]);
      setForgottenRaw([]);
    } finally {
      setLoading(false);
    }
  }

  // 잊보/트래킹 정렬 규칙
  // - tracked: 서버가 내려준 nextSpawnAt을 기준으로 임박한 순으로 정렬 (없으면 맨 아래)
  // - forgotten: 마지막 컷 + respawn 분 단위로 "현재 시각 이후 가장 가까운 도래 주기"로 굴려서 임박 순 정렬
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

  const handleCut = (b: BossDto) => {
    setSelectedBoss(b);
    setCutOpen(true);
  };

  return (
    <div className="grid grid-cols-3 gap-4 h-[calc(100vh-56px)]">
      {/* 1) 좌측: 진행중 보스타임 (임박 순) */}
      <section className="col-span-1 h-full overflow-y-auto px-1">
        <h2 className="text-base font-semibold mb-2 text-slate-700">진행중 보스타임</h2>
        <div className="space-y-2">
          {loading ? (
            <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-500">
              불러오는 중…
            </div>
          ) : trackedSorted.length === 0 ? (
            <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-400 italic">
              스케줄 추적 중인 보스가 없습니다.
            </div>
          ) : (
            trackedSorted.map((b) => <BossCard key={b.id} b={b} onCut={handleCut} />)
          )}
        </div>
      </section>

      {/* 2) 가운데: 잊어버린 보스타임 (예상 젠 임박 순) */}
      <section className="col-span-1 h-full overflow-y-auto px-1">
        <h2 className="text-base font-semibold mb-2 text-slate-700">잊어버린 보스타임</h2>
        <div className="space-y-2">
          {loading ? (
            <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-500">
              불러오는 중…
            </div>
          ) : forgottenSorted.length === 0 ? (
            <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-400 italic">
              잊어버린 보스가 없습니다.
            </div>
          ) : (
            forgottenSorted.map((b) => (
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