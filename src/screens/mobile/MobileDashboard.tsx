import React, { useEffect, useMemo, useState } from "react";
import { postJSON } from "@/lib/http";
import type { BossDto } from "../../types";

/** 시간 상수 */
const MS = 1000;
const MIN = 60 * MS;
const HIGHLIGHT_MS = 5 * MIN;
const OVERDUE_GRACE_MS = 10 * MIN;

/** 다음 젠(ms) 계산: tracked(=nextSpawnAt 우선) / forgotten(=lastCutAt+respawn) */
function nextMsFor(b: BossDto, now = Date.now()): number {
  // tracked
  if (b.nextSpawnAt) {
    const t = new Date(b.nextSpawnAt).getTime();
    if (Number.isFinite(t)) return t;
  }
  // forgotten
  const respawnMin = Number(b.respawn ?? 0);
  if (!Number.isFinite(respawnMin) || respawnMin <= 0 || !b.lastCutAt) return Number.POSITIVE_INFINITY;
  const last = new Date(b.lastCutAt).getTime();
  if (!Number.isFinite(last)) return Number.POSITIVE_INFINITY;
  const step = Math.max(1, Math.round(respawnMin * 60 * 1000));
  const diff = now - last;
  if (diff <= 0) return last + step; // 미래 컷이라면 1사이클 뒤
  const k = Math.max(1, Math.ceil(diff / step));
  return last + k * step;
}

function remainLabel(ms: number) {
  if (!Number.isFinite(ms)) return { text: "미입력", tone: "normal" as const };
  const diff = ms - Date.now();
  if (diff <= 0 && diff >= -OVERDUE_GRACE_MS) return { text: "지남(유예)", tone: "soon" as const };
  if (diff < -OVERDUE_GRACE_MS) return { text: "지남", tone: "past" as const };
  const m = Math.floor(diff / 60000);
  const s = Math.ceil((diff % 60000) / 1000);
  return { text: `${m}분 ${String(s).padStart(2, "0")}초 뒤 젠`, tone: diff <= HIGHLIGHT_MS ? "soon" as const : "normal" as const };
}

/** API: 최근 타임라인 id */
async function latestTimelineIdForBossName(bossName: string): Promise<string | null> {
  try {
    const resp = await postJSON<{ ok: true; id: string | null; empty: boolean }>(
      "/v1/dashboard/boss-timelines/latest-id",
      { bossName, preferEmpty: true }
    );
    return resp?.id ?? null;
  } catch {
    return null;
  }
}

/** 즉시 컷 */
async function instantCut(b: BossDto, onAfter?: () => void) {
  try {
    await postJSON(`/v1/dashboard/bosses/${b.id}/cut`, {
      cutAtIso: new Date().toString(),
      mode: "TREASURY",
      items: [],
      participants: [],
    });
    onAfter?.();
  } catch (e: any) {
    alert(e?.message ?? "즉시 컷 실패");
  }
}

/** 멍 */
async function addDaze(b: BossDto, onAfter?: () => void) {
  try {
    const tlId = await latestTimelineIdForBossName(b.name);
    if (!tlId) {
      alert("해당 보스의 최근 컷 타임라인을 찾을 수 없습니다.");
      return;
    }
    await postJSON(`/v1/boss-timelines/${tlId}/daze`, { atIso: new Date().toString() });
    onAfter?.();
  } catch {
    alert("멍 기록에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

export default function MobileDashboard() {
  const [bossesTracked, setTracked] = useState<BossDto[]>([]);
  const [bossesForgotten, setForgotten] = useState<BossDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await postJSON<any>("/v1/dashboard/bosses");
        setTracked(data.tracked ?? []);
        setForgotten(data.forgotten ?? []);
      } catch {
        setTracked([]); setForgotten([]);
      } finally {
        setLoading(false);
      }
    };
    load();
    const t1 = setInterval(load, 60_000);
    const t2 = setInterval(() => setTick(x => (x + 1) % 60), 1000); // 1초마다 남은 시간 갱신
    return () => { clearInterval(t1); clearInterval(t2); };
  }, []);

  const sortedAll = useMemo(() => {
    const now = Date.now();
    const merged = [...bossesTracked, ...bossesForgotten];
    const seen = new Set<string>();
    const dedup = merged.filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)));
    return dedup.sort((a, b) => nextMsFor(a, now) - nextMsFor(b, now));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bossesTracked, bossesForgotten, tick]);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="py-4">
        {loading ? (
          <div className="px-[5%] py-2 text-sm text-gray-300">불러오는 중…</div>
        ) : sortedAll.length === 0 ? (
          <div className="px-[5%] py-2 text-sm text-gray-400">표시할 보스가 없습니다.</div>
        ) : (
          <ul className="space-y-3">
            {sortedAll.map((b) => {
              const nms = nextMsFor(b);
              const r = remainLabel(nms);
              const isSoon = r.tone === "soon";
              return (
                <li key={b.id} className="px-[5%]">
                  <div className={`w-full rounded-xl shadow-sm border ${isSoon ? "ring-2 ring-rose-400 bg-rose-50/10" : "border-white/15 bg-white/5"} p-3`}>
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-[15px]">{b.name}</div>
                      <div className={`text-[12px] ${isSoon ? "text-rose-300" : "text-gray-300"}`}>{r.text}</div>
                    </div>

                    <div className="mt-1 flex items-center justify-between">
                      <div className="text-[12px] text-gray-300 truncate">
                        젠 위치: <span className="font-medium text-gray-100">{b.location ?? "—"}</span>
                      </div>

                      <div className="flex gap-2">
                        {/* 컷: 검정 버튼 */}
                        <button
                          onClick={() => instantCut(b, undefined)}
                          className="px-3 py-1.5 rounded-md bg-black text-white text-[12px] border border-white/30 hover:bg-white/10 active:opacity-80"
                        >
                          컷
                        </button>

                        {/* 멍: 하양 버튼 */}
                        <button
                          onClick={() => addDaze(b, undefined)}
                          className="px-3 py-1.5 rounded-md bg-white text-black text-[12px] hover:bg-gray-100 active:opacity-80"
                        >
                          멍
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}