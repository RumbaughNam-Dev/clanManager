// src/screens/dashboard/LoggedInDashboard.tsx
import { useState, useEffect, useMemo } from "react";
import { postJSON } from "@/lib/http";
import BossCard from "./BossCard";
import ForgottenCard from "./ForgottenCard";
import CutModal from "./CutModal";
import type { BossDto, ListBossesResp } from "../../types";
import { formatNow } from "../../utils/util";

const MS = 1000;
const MIN = 60 * MS;
// 음성 알림 시점들 (5분, 3분, 1분)
const ALERT_THRESHOLDS = [5 * MIN, 3 * MIN, 1 * MIN] as const;
// 카드 하이라이트 기준(5분 이내)
const HIGHLIGHT_MS = 5 * MIN;

export default function LoggedInDashboard() {
  // 서버에서 분류되어 오는 리스트(기본)
  const [trackedRaw, setTrackedRaw] = useState<BossDto[]>([]);
  const [forgottenRaw, setForgottenRaw] = useState<BossDto[]>([]);
  const [loading, setLoading] = useState(true);

  // 검색어 (좌/중 섹션 동시 필터)
  const [query, setQuery] = useState("");

  // 음성 알림 on/off (로컬 저장)
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem("voiceEnabled");
      return v == null ? true : v === "1";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("voiceEnabled", voiceEnabled ? "1" : "0");
    } catch {}
  }, [voiceEnabled]);

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

  // 정렬 + (잊보) 예측 젠 시각 map 계산
  const { trackedSorted, forgottenSorted, forgottenNextMap } = useMemo(() => {
    const now = Date.now();

    const safeTime = (iso?: string | null) =>
      iso ? new Date(iso).getTime() : Number.POSITIVE_INFINITY;

    const trackedSorted = [...trackedRaw].sort(
      (a, b) => safeTime(a.nextSpawnAt) - safeTime(b.nextSpawnAt)
    );

    const forgottenNextMap = new Map<string, number>();
    const pred = forgottenRaw.map((b) => {
      if (!b.lastCutAt || !b.respawn || b.respawn <= 0) {
        forgottenNextMap.set(b.id, Number.POSITIVE_INFINITY);
        return { b, predicted: Number.POSITIVE_INFINITY };
      }
      const lastMs = new Date(b.lastCutAt).getTime();
      if (isNaN(lastMs)) {
        forgottenNextMap.set(b.id, Number.POSITIVE_INFINITY);
        return { b, predicted: Number.POSITIVE_INFINITY };
      }
      const step = Math.max(1, Math.round(b.respawn * 60 * 1000)); // 분→ms
      const diff = now - lastMs;
      const k = Math.max(1, Math.ceil(diff / step));
      const nextMs = lastMs + k * step;
      forgottenNextMap.set(b.id, nextMs);
      return { b, predicted: nextMs };
    });

    const forgottenSorted = pred.sort((x, y) => x.predicted - y.predicted).map(({ b }) => b);

    return { trackedSorted, forgottenSorted, forgottenNextMap };
  }, [trackedRaw, forgottenRaw, tick]);

  // 검색(스크립트로만)
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

  // 남은시간 계산: 진행중은 nextSpawnAt, 잊보는 forgottenNextMap 사용
  const remainingMsFor = (b: BossDto, type: "tracked" | "forgotten") => {
    const now = Date.now();
    const next =
      type === "tracked"
        ? b.nextSpawnAt
          ? new Date(b.nextSpawnAt).getTime()
          : Number.POSITIVE_INFINITY
        : forgottenNextMap.get(b.id) ?? Number.POSITIVE_INFINITY;
    return next - now;
  };

  // ── 알림: 5/3/1분 이내일 때 음성(또는 비프) — 각 시점 1회만 ─────────────
  // Map<bossId, Set<thresholdMs>>
  const [alertedMap, setAlertedMap] = useState<Map<string, Set<number>>>(new Map());

  useEffect(() => {
    if (!voiceEnabled) return;

    const toSpeak: Array<{ id: string; name: string; threshold: number }> = [];

    const checkList = (list: BossDto[], type: "tracked" | "forgotten") => {
      for (const b of list) {
        const r = remainingMsFor(b, type);
        if (!(r > 0)) continue;

        for (const th of ALERT_THRESHOLDS) {
          if (r <= th) {
            const prev = alertedMap.get(b.id);
            const already = prev?.has(th);
            if (!already) {
              toSpeak.push({ id: b.id, name: b.name, threshold: th });
            }
            break; // 더 작은 임계치들은 나중에 다시 체크됨
          }
        }
      }
    };

    checkList(trackedFiltered, "tracked");
    checkList(forgottenFiltered, "forgotten");

    if (toSpeak.length > 0) {
      (async () => {
        for (const x of toSpeak) {
          const minStr = x.threshold === 5 * MIN ? "5분" : x.threshold === 3 * MIN ? "3분" : "1분";
          try {
            await speakKorean(`${x.name} 보스 시간 ${minStr} 전입니다.`);
          } catch {
            await playBeep(250);
          }
          await delay(120);
        }
      })().catch(() => {});

      // 알림한 임계치 기록
      setAlertedMap((prev) => {
        const next = new Map(prev);
        for (const x of toSpeak) {
          const set = new Set(next.get(x.id) ?? []);
          set.add(x.threshold);
          next.set(x.id, set);
        }
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackedFiltered, forgottenFiltered, tick, voiceEnabled]);

  function delay(ms: number) {
    return new Promise((res) => setTimeout(res, ms));
  }

  // 간단 비프음 (Web Audio API) — 스피치 실패 폴백용
  function playBeep(durationMs = 300) {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return Promise.resolve(); // 지원 안 하면 무시
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        osc.stop();
        ctx.close().finally(() => resolve());
      }, durationMs);
    });
  }

  // 한국어 음성 출력 (지원 안 하면 reject → 상위에서 비프 폴백)
  function speakKorean(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ss: SpeechSynthesis | undefined = (window as any).speechSynthesis;
      if (!ss || typeof window === "undefined") return reject(new Error("speechSynthesis not available"));

      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "ko-KR";
      utter.rate = 1;
      utter.pitch = 1;
      const pickVoice = () => {
        const voices = ss.getVoices?.() || [];
        const ko = voices.find((v) => /ko[-_]KR/i.test(v.lang)) || voices.find((v) => v.lang?.startsWith("ko"));
        if (ko) utter.voice = ko;
        ss.speak(utter);
      };

      utter.onend = () => resolve();
      utter.onerror = (e) => reject(e.error || new Error("speech error"));

      if (ss.getVoices && ss.getVoices().length > 0) {
        pickVoice();
      } else {
        const handler = () => {
          ss.onvoiceschanged = null as any;
          pickVoice();
        };
        ss.onvoiceschanged = handler;
        setTimeout(() => {
          if (ss.onvoiceschanged === handler) {
            ss.onvoiceschanged = null as any;
            pickVoice();
          }
        }, 500);
      }
    });
  }

  const handleCut = (b: BossDto) => {
    setSelectedBoss(b);
    setCutOpen(true);
  };

  // 강조 UI 클래스(5분 이내)
  const highlightWrap =
    "rounded-xl ring-2 ring-rose-300 bg-rose-50/60 transition-colors";
  const badge = (
    <div className="mb-1 -mt-1">
      <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-medium bg-rose-500/10 text-rose-700 border border-rose-200">
        5분 내 젠!
      </span>
    </div>
  );

  return (
    <div className="grid grid-rows-[auto_1fr] gap-3 h-[calc(100vh-56px)]">
      {/* 검색 바 + 음성 알림 토글 */}
      <div className="flex items-center gap-3">
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

        <label className="flex items-center gap-2 text-sm select-none">
          <input
            type="checkbox"
            checked={voiceEnabled}
            onChange={(e) => setVoiceEnabled(e.currentTarget.checked)}
          />
          음성 알림
        </label>
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
              trackedFiltered.map((b) => {
                const remain = remainingMsFor(b, "tracked");
                const highlight = remain <= HIGHLIGHT_MS && remain > 0;
                return (
                  <div key={b.id} className={highlight ? highlightWrap : ""}>
                    {highlight && badge}
                    <BossCard b={b} onCut={handleCut} />
                  </div>
                );
              })
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
              forgottenFiltered.map((b) => {
                const remain = remainingMsFor(b, "forgotten");
                const highlight = remain <= HIGHLIGHT_MS && remain > 0;
                return (
                  <div key={b.id} className={highlight ? highlightWrap : ""}>
                    {highlight && badge}
                    <ForgottenCard b={b} onCut={handleCut} extraNextLabel="예상 다음 젠" />
                  </div>
                );
              })
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