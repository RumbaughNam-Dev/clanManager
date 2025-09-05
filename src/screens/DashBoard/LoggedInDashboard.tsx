import { useState, useEffect, useMemo, useRef } from "react";
import { postJSON } from "@/lib/http";
import BossCard from "./BossCard";
import ForgottenCard from "./ForgottenCard";
import CutModal from "./CutModal";
import type { BossDto, ListBossesResp } from "../../types";
import { formatNow } from "../../utils/util";

const MS = 1000;
const MIN = 60 * MS;

// 음성 알림 시점들 (5분, 1분)
const ALERT_THRESHOLDS = [5 * MIN, 1 * MIN] as const;
// 임박 하이라이트 기준(5분 이내)
const HIGHLIGHT_MS = 5 * MIN;
// 지나간 보스, 위에 유지하는 유예(3분) — 파란색으로 고정
const OVERDUE_GRACE_MS = 3 * MIN;
// “미기록 경고” 음성 알림 시점(지나간 3분)
const MISSED_WARN_MS = 3 * MIN;

// ---- 로컬 스토리지 key 헬퍼 ----
const LS_DAZE = "bossDazeCounts"; // { [bossId]: number }
const LS_MISS = "bossMissCounts"; // { [bossId]: number }

type CountMap = Record<string, number>;

function readCounts(key: string): CountMap {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") return obj;
  } catch {}
  return {};
}
function writeCounts(key: string, val: CountMap) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {}
}

export default function LoggedInDashboard() {
  const [trackedRaw, setTrackedRaw] = useState<BossDto[]>([]);
  const [forgottenRaw, setForgottenRaw] = useState<BossDto[]>([]);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState("");

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

  const [cutOpen, setCutOpen] = useState(false);
  const [selectedBoss, setSelectedBoss] = useState<BossDto | null>(null);

  // 간편 컷 입력
  const [quickCutText, setQuickCutText] = useState("");
  const [quickSaving, setQuickSaving] = useState(false);

  // 멍/미입력 횟수 (로컬 관리)
  const [dazeCounts, setDazeCounts] = useState<CountMap>(() => readCounts(LS_DAZE));
  const [missCounts, setMissCounts] = useState<CountMap>(() => readCounts(LS_MISS));

  // 주기 틱(30초)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // 직전 nextSpawnAt 보관(서버가 바로 null로 내려도 계산용으로 유지)
  const lastNextSpawnRef = useRef<Map<string, number>>(new Map());
  // “지나감 유지 마감 시각(nextMs + 3분)” 보관 — 반드시 클라에서 강제관리
  const overdueUntilRef = useRef<Map<string, number>>(new Map());
  // “미기록 경고(3분)” 발화 여부
  const missedWarnSetRef = useRef<Set<string>>(new Set());

  // 초기 로드 + 1분마다 갱신
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

      // latest nextSpawnAt 저장(없으면 이전값 유지)
      const map = new Map(lastNextSpawnRef.current);
      for (const b of data.tracked ?? []) {
        if (b.nextSpawnAt) {
          const ms = new Date(b.nextSpawnAt).getTime();
          if (Number.isFinite(ms)) map.set(b.id, ms);
        }
      }
      lastNextSpawnRef.current = map;
    } catch {
      setTrackedRaw([]);
      setForgottenRaw([]);
    } finally {
      setLoading(false);
    }
  }

  // ===== 공통 계산 유틸 =====
  const getNextMsTracked = (b: BossDto) => {
    if (b.nextSpawnAt) {
      const t = new Date(b.nextSpawnAt).getTime();
      if (Number.isFinite(t)) return t;
    }
    const m = lastNextSpawnRef.current.get(b.id);
    return m ?? Number.POSITIVE_INFINITY;
  };

  // 정렬 + (잊보) 예측 젠 시각 map 계산
  const { trackedSorted, forgottenSorted, forgottenNextMap, allBosses } = useMemo(() => {
    const now = Date.now();

    // 잊보 예측
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

    // 진행중 보스 정렬 — “지나갔고 3분 유예가 남아있으면” 최상단 유지(키=0)
    const trackedSorted = [...trackedRaw].sort((a, b) => {
      const now = Date.now();

      const nextA = getNextMsTracked(a);
      const nextB = getNextMsTracked(b);

      const overdueUntilA = overdueUntilRef.current.get(a.id);
      const overdueUntilB = overdueUntilRef.current.get(b.id);

      const isAOverKeep = overdueUntilA != null && now < overdueUntilA; // 3분 내
      const isBOverKeep = overdueUntilB != null && now < overdueUntilB;

      // 1순위: 3분 유예중이면 항상 상단(키=0)
      const keyA = isAOverKeep
        ? 0
        : Number.isFinite(nextA)
          ? Math.max(nextA - now, 0) // 임박/미도래
          : Number.POSITIVE_INFINITY;

      const keyB = isBOverKeep
        ? 0
        : Number.isFinite(nextB)
          ? Math.max(nextB - now, 0)
          : Number.POSITIVE_INFINITY;

      return keyA - keyB;
    });

    const allBosses = [...trackedRaw, ...forgottenRaw];
    return { trackedSorted, forgottenSorted, forgottenNextMap, allBosses };
  }, [trackedRaw, forgottenRaw, tick]);

  // 검색
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

  // ===== 남은시간/지남시간 계산(+ 유예/경고 상태 갱신) =====
  const remainingMsForTrackedWithOverdue = (b: BossDto) => {
    const now = Date.now();
    const nextMs = getNextMsTracked(b);
    const overdueUntil = overdueUntilRef.current.get(b.id);

    // ✅ 유예 중이면 nextSpawnAt이 미래로 바뀌어도 항상 "지남"으로 취급
    if (overdueUntil && now < overdueUntil) {
      const overdueStart = overdueUntil - OVERDUE_GRACE_MS;
      return -(now - overdueStart); // 계속 음수 유지(파란색 유지 & 3분 경고 동작)
    }

    if (!Number.isFinite(nextMs)) {
      return Number.POSITIVE_INFINITY;
    }

    const diff = nextMs - now;

    // 처음 지났을 때 유예 등록
    if (diff <= 0) {
      const target = nextMs + OVERDUE_GRACE_MS;
      const existing = overdueUntilRef.current.get(b.id);
      if (!existing || existing < target) overdueUntilRef.current.set(b.id, target);
    } else {
      // 아직 안 지났으면 혹시 남아있던 유예는 정리
      if (overdueUntilRef.current.has(b.id) && now >= (overdueUntilRef.current.get(b.id) || 0)) {
        overdueUntilRef.current.delete(b.id);
        missedWarnSetRef.current.delete(b.id);
      }
    }

    return diff;
  };

  const remainingMsFor = (b: BossDto, type: "tracked" | "forgotten") => {
    if (type === "tracked") return remainingMsForTrackedWithOverdue(b);
    const now = Date.now();
    const next = forgottenNextMap.get(b.id) ?? Number.POSITIVE_INFINITY;
    return next - now;
  };

  // ── 음성 알림(5분/1분) + “미기록 경고(지나간 3분)” ──────────────────────
  const [alertedMap, setAlertedMap] = useState<Map<string, Set<number>>>(new Map()); // 5분/1분

  useEffect(() => {
    if (!voiceEnabled) return;

    const toSpeak: Array<{ id: string; name: string; threshold: number }> = [];
    const toWarnMissed: Array<{ id: string; name: string }> = [];

    // 5분/1분 남음 알림 (tracked+forgotten)
    const checkAheadList = (list: BossDto[], type: "tracked" | "forgotten") => {
      for (const b of list) {
        const r = remainingMsFor(b, type);
        if (!(r > 0)) continue;

        const prev = alertedMap.get(b.id);
        for (const th of ALERT_THRESHOLDS) {
          if (r <= th && !(prev?.has(th))) {
            toSpeak.push({ id: b.id, name: b.name, threshold: th });
          }
        }
      }
    };

    // 지나간 3분 경고(“보스 시간이 기록되지 않았습니다.”) — tracked만
    const checkMissed = (list: BossDto[]) => {
      for (const b of list) {
        const r = remainingMsFor(b, "tracked"); // 음수면 지남
        // r ≈ -(지나간 ms). 3분 부근에서 단 한 번만
        if (r <= -MISSED_WARN_MS && r > -(MISSED_WARN_MS + 30 * MS)) {
          if (!missedWarnSetRef.current.has(b.id)) {
            toWarnMissed.push({ id: b.id, name: b.name });
          }
        }
      }
    };

    checkAheadList(trackedFiltered, "tracked");
    checkAheadList(forgottenFiltered, "forgotten");
    checkMissed(trackedFiltered);

    if (toSpeak.length > 0 || toWarnMissed.length > 0) {
      (async () => {
        for (const x of toSpeak) {
          const minStr = x.threshold === 5 * MIN ? "5분" : "1분";
          try {
            await speakKorean(`${x.name} 보스 젠 ${minStr} 전입니다.`);
          } catch {
            await playBeep(250);
          }
          await delay(120);
        }
        for (const x of toWarnMissed) {
          try {
            await speakKorean(`${x.name} 보스 시간이 기록되지 않았습니다.`);
          } catch {
            await playBeep(300);
          }
          await delay(120);
          missedWarnSetRef.current.add(x.id);

          // ✅ 미입력 횟수 +1 (로컬)
          setMissCounts((prev) => {
            const next = { ...prev, [x.id]: (prev[x.id] ?? 0) + 1 };
            writeCounts(LS_MISS, next);
            return next;
          });
        }
      })().catch(() => {});

      if (toSpeak.length > 0) {
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackedFiltered, forgottenFiltered, tick, voiceEnabled]);

  function delay(ms: number) {
    return new Promise((res) => setTimeout(res, ms));
  }

  function playBeep(durationMs = 300) {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return Promise.resolve();
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

  // ── 간편 보스 컷 ─────────────────────────────────────────
  // 형식: "1550 서드", "15:50 서드", "930 악마왕"
  function parseQuickCut(text: string, list: BossDto[]) {
    const s = text.trim();
    if (!s) return null;
    const parts = s.split(/\s+/);
    if (parts.length < 2) return null;

    const timeRaw = parts[0];
    const nameQuery = parts.slice(1).join(" ").toLowerCase();

    let hh = NaN, mm = NaN;
    if (/^\d{3,4}$/.test(timeRaw)) {
      const str = timeRaw.padStart(4, "0");
      hh = parseInt(str.slice(0, 2), 10);
      mm = parseInt(str.slice(2, 4), 10);
    } else if (/^\d{1,2}:\d{2}$/.test(timeRaw)) {
      const [h, m] = timeRaw.split(":");
      hh = parseInt(h, 10);
      mm = parseInt(m, 10);
    } else {
      return null;
    }
    if (!(hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59)) return null;

    const hay = (b: BossDto) => `${b.name} ${b.location ?? ""}`.toLowerCase();
    const candidates = list.filter((b) => hay(b).includes(nameQuery));
    if (candidates.length === 0) return { boss: null, iso: null };

    const boss = candidates[0];

    const d = new Date();
    d.setSeconds(0, 0);
    d.setHours(hh, mm, 0, 0);
    const iso = d.toISOString();

    return { boss, iso };
  }

  async function submitQuickCut() {
    if (quickSaving) return;
    const parsed = parseQuickCut(quickCutText, allBosses);
    if (!parsed) {
      alert("형식: 시각 보스이름\n예) 2200 서드 / 22:00 서드 / 930 악마왕");
      return;
    }
    if (!parsed.boss) {
      alert("입력한 보스명을 찾을 수 없습니다. (현재 목록에서 검색됩니다)");
      return;
    }

    setQuickSaving(true);
    try {
      await postJSON(`/v1/dashboard/bosses/${parsed.boss.id}/cut`, {
        cutAtIso: parsed.iso,
        mode: "TREASURY",
        items: [],
        participants: [],
      });
      setQuickCutText("");
      // 컷/멍 처리되면 해당 보스의 미입력 횟수는 0으로 리셋
      setMissCounts((prev) => {
        const next = { ...prev, [parsed.boss!.id]: 0 };
        writeCounts(LS_MISS, next);
        return next;
      });
      // 유예/경고 플래그 클리어
      overdueUntilRef.current.delete(parsed.boss.id);
      missedWarnSetRef.current.delete(parsed.boss.id);

      await loadBosses();
      alert(
        `[간편컷] ${parsed.boss.name} · ${new Date(parsed.iso!).toLocaleTimeString("ko-KR", { hour12: false })} 저장됨`
      );
    } catch (e: any) {
      alert(e?.message ?? "간편컷 저장 실패");
    } finally {
      setQuickSaving(false);
    }
  }

  // 버튼: 즉시 컷(지금 시각)
  async function instantCut(b: BossDto) {
    try {
      await postJSON(`/v1/dashboard/bosses/${b.id}/cut`, {
        cutAtIso: new Date().toISOString(),
        mode: "TREASURY",
        items: [],
        participants: [],
      });
      // 미입력 리셋
      setMissCounts((prev) => {
        const next = { ...prev, [b.id]: 0 };
        writeCounts(LS_MISS, next);
        return next;
      });
      overdueUntilRef.current.delete(b.id);
      missedWarnSetRef.current.delete(b.id);
      await loadBosses();
    } catch (e: any) {
      alert(e?.message ?? "즉시 컷 실패");
    }
  }

  // 버튼: 멍 +1
  function addDaze(b: BossDto) {
    setDazeCounts((prev) => {
      const next = { ...prev, [b.id]: (prev[b.id] ?? 0) + 1 };
      writeCounts(LS_DAZE, next);
      return next;
    });
    // 멍 찍었으면 미입력은 0으로(“바로 직전 타임에 멍이나 컷이나 했으면 왼쪽 섹션”)
    setMissCounts((prev) => {
      const next = { ...prev, [b.id]: 0 };
      writeCounts(LS_MISS, next);
      return next;
    });
    overdueUntilRef.current.delete(b.id);
    missedWarnSetRef.current.delete(b.id);
  }

  // 강조 UI 클래스
  const highlightSoonWrap = "rounded-xl ring-2 ring-rose-300 bg-rose-50/60 transition-colors";
  const highlightOverWrap = "rounded-xl ring-2 ring-sky-300 bg-sky-50/60 transition-colors";

  const soonBadge = (
    <div className="mb-1 -mt-1">
      <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-medium bg-rose-500/10 text-rose-700 border border-rose-200">
        5분 내 젠!
      </span>
    </div>
  );

  const overBadge = (minsOver: number) => (
    <div className="mb-1 -mt-1">
      <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-medium bg-sky-500/10 text-sky-700 border border-sky-200">
        {minsOver}분 지남
      </span>
    </div>
  );

  // 좌/중 섹션 분리: 미입력 1회 이상 → 중앙, 그 외(최근 컷/멍 처리 포함) → 좌측
  const leftTracked = useMemo(
    () => trackedFiltered.filter((b) => (missCounts[b.id] ?? 0) === 0),
    [trackedFiltered, missCounts]
  );
  const middleTracked = useMemo(
    () => trackedFiltered.filter((b) => (missCounts[b.id] ?? 0) > 0),
    [trackedFiltered, missCounts]
  );

  return (
    <div className="grid grid-rows-[auto_1fr] gap-3 h-[calc(100vh-56px)]">
      {/* 검색 바 + 음성 알림 토글 + 간편 보스 컷 */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* 검색 */}
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

        {/* 음성 알림 토글 */}
        <label className="flex items-center gap-2 text-sm select-none">
          <input
            type="checkbox"
            checked={voiceEnabled}
            onChange={(e) => setVoiceEnabled(e.currentTarget.checked)}
          />
          음성 알림
        </label>

        {/* 간편 보스 컷 */}
        <div className="flex items-center gap-2">
          <input
            className="border rounded-xl px-3 py-2 w-[280px]"
            placeholder="간편 보스 컷: 2200 서드"
            value={quickCutText}
            onChange={(e) => setQuickCutText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitQuickCut();
              }
            }}
            title="형식: 시각 보스이름 (예: 2200 서드 / 22:00 서드 / 930 악마왕)"
          />
          <button
            type="button"
            className={`px-3 py-2 rounded-xl text-white ${quickSaving ? "bg-gray-300" : "bg-slate-900 hover:opacity-90"}`}
            onClick={submitQuickCut}
            disabled={quickSaving}
          >
            {quickSaving ? "저장 중…" : "간편컷 저장"}
          </button>
        </div>
      </div>

      {/* 본문 그리드 */}
      <div className="grid grid-cols-3 gap-4 min-h-0">
        {/* 1) 좌측: 진행중 보스타임 (임박/지남 3분 유예 포함) — 미입력 0회 */}
        <section className="col-span-1 min-h-0 overflow-y-auto px-1">
          <h2 className="text-base font-semibold mb-2 text-slate-700">
            진행중 보스타임
            {query ? (
              <span className="ml-2 text-xs text-slate-400">
                (검색결과 {leftTracked.length}개)
              </span>
            ) : null}
          </h2>
          <div className="space-y-2">
            {loading ? (
              <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-500">
                불러오는 중…
              </div>
            ) : leftTracked.length === 0 ? (
              <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-400 italic">
                {query ? "검색 결과가 없습니다." : "스케줄 추적 중인 보스가 없습니다."}
              </div>
            ) : (
              leftTracked.map((b) => {
                const remain = remainingMsFor(b, "tracked");

                // ✅ 유예 중 여부/지남 분 계산(서버 next가 바뀌어도 파란색 유지)
                const overdueUntil = overdueUntilRef.current.get(b.id);
                const now = Date.now();
                const isOverdueKeep = !!overdueUntil && now < overdueUntil;
                const minsOver = isOverdueKeep
                  ? Math.max(1, Math.ceil((now - (overdueUntil - OVERDUE_GRACE_MS)) / MIN))
                  : Math.max(1, Math.ceil(-remain / MIN)); // 안전망

                const soon = remain <= HIGHLIGHT_MS && remain > 0 && !isOverdueKeep;
                const justOver = isOverdueKeep; // ✅ 유예중이면 무조건 파란색

                const wrapClass = soon ? highlightSoonWrap : justOver ? highlightOverWrap : "";

                const daze = dazeCounts[b.id] ?? 0;
                const miss = missCounts[b.id] ?? 0;

                return (
                  <div key={b.id} className={wrapClass}>
                    {soon && soonBadge}
                    {justOver && overBadge(minsOver)}
                    <BossCard b={b} onCut={() => handleCut(b)} />

                    {/* 액션 바 */}
                    <div className="mt-2 flex items-center gap-2 px-1 pb-1">
                      <button
                        type="button"
                        onClick={() => handleCut(b)}
                        className="px-2 py-1 rounded-md border text-xs hover:bg-slate-50"
                        title="상세 입력 모달 열기"
                      >
                        상세 컷
                      </button>
                      <button
                        type="button"
                        onClick={() => instantCut(b)}
                        className="px-2 py-1 rounded-md border text-xs bg-slate-900 text-white hover:opacity-90"
                        title="지금 시간으로 즉시 컷"
                      >
                        컷
                      </button>
                      <button
                        type="button"
                        onClick={() => addDaze(b)}
                        className="px-2 py-1 rounded-md border text-xs hover:bg-slate-50"
                        title="멍 +1"
                      >
                        멍
                      </button>

                      <span className="ml-3 text-[11px] text-slate-500">
                        멍 <b className="text-slate-700">{daze}</b>회
                      </span>
                      <span className="text-[11px] text-slate-500">
                        미입력 <b className="text-slate-700">{miss}</b>회
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* 2) 가운데: 미입력된 보스 (미입력 1회 이상) */}
        <section className="col-span-1 min-h-0 overflow-y-auto px-1">
          <h2 className="text-base font-semibold mb-2 text-slate-700">
            미입력된 보스
            {query ? (
              <span className="ml-2 text-xs text-slate-400">
                (검색결과 {middleTracked.length}개)
              </span>
            ) : null}
          </h2>
          <div className="space-y-2">
            {loading ? (
              <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-500">
                불러오는 중…
              </div>
            ) : middleTracked.length === 0 ? (
              <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-400 italic">
                {query ? "검색 결과가 없습니다." : "미입력된 보스가 없습니다."}
              </div>
            ) : (
              middleTracked.map((b) => {
                const remain = remainingMsFor(b, "tracked");
                const overdueUntil = overdueUntilRef.current.get(b.id);
                const now = Date.now();
                const isOverdueKeep = !!overdueUntil && now < overdueUntil;
                const minsOver = isOverdueKeep
                  ? Math.max(1, Math.ceil((now - (overdueUntil - OVERDUE_GRACE_MS)) / MIN))
                  : Math.max(1, Math.ceil(-remain / MIN));

                const soon = remain <= HIGHLIGHT_MS && remain > 0 && !isOverdueKeep;
                const justOver = isOverdueKeep;
                const wrapClass = soon ? highlightSoonWrap : justOver ? highlightOverWrap : "";

                const daze = dazeCounts[b.id] ?? 0;
                const miss = missCounts[b.id] ?? 0;

                return (
                  <div key={b.id} className={wrapClass}>
                    {soon && soonBadge}
                    {justOver && overBadge(minsOver)}
                    <BossCard b={b} onCut={() => handleCut(b)} />

                    {/* 액션 바 */}
                    <div className="mt-2 flex items-center gap-2 px-1 pb-1">
                      <button
                        type="button"
                        onClick={() => handleCut(b)}
                        className="px-2 py-1 rounded-md border text-xs hover:bg-slate-50"
                      >
                        상세 컷
                      </button>
                      <button
                        type="button"
                        onClick={() => instantCut(b)}
                        className="px-2 py-1 rounded-md border text-xs bg-slate-900 text-white hover:opacity-90"
                      >
                        컷
                      </button>
                      <button
                        type="button"
                        onClick={() => addDaze(b)}
                        className="px-2 py-1 rounded-md border text-xs hover:bg-slate-50"
                      >
                        멍
                      </button>

                      <span className="ml-3 text-[11px] text-slate-500">
                        멍 <b className="text-slate-700">{daze}</b>회
                      </span>
                      <span className="text-[11px] text-slate-500">
                        미입력 <b className="text-slate-700">{miss}</b>회
                      </span>
                    </div>
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

      {/* 잊보 섹션은 그대로(정렬/하이라이트만 적용) */}
      {/* 필요 시 잊보를 별도 컬럼으로 두고 싶으면 위 레이아웃 조정 */}

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