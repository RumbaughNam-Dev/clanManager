import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { postJSON } from "@/lib/http";
import type { BossDto } from "../../types";

/** ───────── 상수 ───────── */
const MS = 1000;
const MIN = 60 * MS;
const DAY = 24 * 60 * MIN;

// 알림 시점(5분, 1분)
const ALERT_THRESHOLDS = [5 * MIN, 1 * MIN] as const;
// 임박(5분 이내) 하이라이트
const HIGHLIGHT_MS = 5 * MIN;
// 비고정: 지남 유예(파랑 유지) 5분
const OVERDUE_GRACE_MS = 5 * MIN;
// 비고정: 지남 3분째 경고 음성
const MISSED_WARN_MS = 3 * MIN;

// 로컬 스토리지 키
// ⬇️ 멍 로컬 스토리지는 사용하지 않음
// const LS_DAZE = "bossDazeCounts";
const LS_MISS = "bossMissCounts";
const LS_OVERDUE_UNTIL = "bossOverdueUntil";

/** ───────── 타입 ───────── */
type FixedBossDto = {
  id: string;
  name: string;
  location: string;
  genTime: number | null;   // 0~1439 (HH*60+mm)
  respawn: number;
  isRandom: boolean;
  lastCutAt: string | null; // 최근 컷
};

type CountMap = Record<string, number>;

/** ───────── 로컬 스토리지 유틸 ───────── */
function readCounts(key: string): CountMap {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") return obj as CountMap;
  } catch {}
  return {};
}

// mm:ss
function fmtMMSS2(ms: number) {
  const pos = Math.max(0, Math.ceil(ms / 1000)); // 남은 시간은 올림
  const m = Math.floor(pos / 60);
  const s = pos % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function writeCounts(key: string, val: CountMap) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {}
}
function readOverdueMap(): Map<string, number> {
  try {
    const raw = localStorage.getItem(LS_OVERDUE_UNTIL);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, number>;
    const m = new Map<string, number>();
    for (const k of Object.keys(obj || {})) {
      const v = Number(obj[k]);
      if (Number.isFinite(v)) m.set(k, v);
    }
    return m;
  } catch {
    return new Map();
  }
}
function writeOverdueMap(m: Map<string, number>) {
  try {
    const obj: Record<string, number> = {};
    m.forEach((v, k) => {
      if (Number.isFinite(v)) obj[k] = v;
    });
    localStorage.setItem(LS_OVERDUE_UNTIL, JSON.stringify(obj));
  } catch {}
}

/** ───────── 컴포넌트 ───────── */
export default function LoggedInDashboard() {
  /** 서버 데이터 */
  const [trackedRaw, setTrackedRaw] = useState<BossDto[]>([]);
  const [forgottenRaw, setForgottenRaw] = useState<BossDto[]>([]);
  const [fixedRaw, setFixedRaw] = useState<FixedBossDto[]>([]);
  const [loading, setLoading] = useState(true);

  /** 검색어(좌/중만 대상) */
  const [query, setQuery] = useState("");

  /** 음성 알림 토글 */
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

  /** 간편 컷 입력(좌/중용) */
  const [quickCutText, setQuickCutText] = useState("");
  const [quickSaving, setQuickSaving] = useState(false);

  /** 로컬 카운트: 미입력만 클라이언트에서 계산/보관 */
  const [missCounts, setMissCounts] = useState<CountMap>(() => readCounts(LS_MISS));

  /** 1초 UI 틱 */
  const [uiTick, setUiTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setUiTick((x) => (x + 1) % 3600), 1000);
    return () => clearInterval(t);
  }, []);

  /** 1분 폴링 */
  useEffect(() => {
    loadBosses();
    const t = setInterval(() => loadBosses(), 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** refs (비고정/공통) */
  const lastNextSpawnRef = useRef<Map<string, number>>(new Map());
  const overdueUntilRef = useRef<Map<string, number>>(new Map());
  const missedWarnSetRef = useRef<Set<string>>(new Set());
  const lastMissMarkedRef = useRef<Map<string, number>>(new Map());
  const timelineIdCacheRef = useRef<Map<string, string>>(new Map());

  /** 고정 보스 음성 알림 상태 (게임일 단위 리셋) */
  const fixedAlertedMapRef = useRef<Map<string, Set<number>>>(new Map());
  const fixedCycleStartRef = useRef<number>(0); // 현재 게임일 시작 ms(05:00 기준)

  /** mount 시: 지남 유예 복원 */
  useEffect(() => {
    overdueUntilRef.current = readOverdueMap();
  }, []);

  // 고정 보스: 이번 발생까지 남은(ms) — (음수면 지남)
  function fixedRemainMs(f: FixedBossDto, nowMs = Date.now()) {
    const occ = fixedOccMs(f.genTime, nowMs);
    if (!Number.isFinite(occ)) return Number.POSITIVE_INFINITY;
    return occ - nowMs;
  }

  /** 서버 로드 */
  async function loadBosses() {
    setLoading(true);
    try {
      const data = await postJSON<any>("/v1/dashboard/bosses");
      setTrackedRaw(data.tracked ?? []);
      setForgottenRaw(data.forgotten ?? []);
      setFixedRaw(
        ((data.fixed ?? []) as any[]).map((f) => ({
          ...f,
          genTime: f.genTime == null ? null : Number(f.genTime),
        }))
      );

      // 비고정: 서버 next 갱신/유예 유지
      const now = Date.now();
      const prevMap = lastNextSpawnRef.current;
      const nextMap = new Map(prevMap);
      let changedOverdue = false;

      for (const b of (data.tracked ?? []) as BossDto[]) {
        const newMs = b.nextSpawnAt ? new Date(b.nextSpawnAt).getTime() : NaN;
        const prevMs = prevMap.get(b.id);
        if (Number.isFinite(prevMs) && now >= (prevMs as number)) {
          const target = (prevMs as number) + OVERDUE_GRACE_MS;
          const existing = overdueUntilRef.current.get(b.id);
          if (!existing || existing < target) {
            overdueUntilRef.current.set(b.id, target);
            changedOverdue = true;
          }
        }
        if (Number.isFinite(newMs)) nextMap.set(b.id, newMs as number);
      }
      lastNextSpawnRef.current = nextMap;
      if (changedOverdue) writeOverdueMap(overdueUntilRef.current);
    } catch {
      setTrackedRaw([]);
      setForgottenRaw([]);
      setFixedRaw([]);
    } finally {
      setLoading(false);
    }
  }

  /** 기록 존재 여부(좌/중) — 서버의 dazeCount 사용 */
  const hasAnyRecord = (b: BossDto) => {
    const serverDaze = (b as any)?.dazeCount ?? 0;
    return !!b.lastCutAt || serverDaze > 0;
  };

  /** 최근 컷 타임라인 id 조회(보스명) */
  type ListTimelinesLite = { ok: true; items: Array<{ id: string | number; bossName: string; cutAt: string }> };
  async function getTimelineIdForBossName(bossName: string): Promise<string | null> {
    const key = bossName?.trim();
    if (!key) return null;
    const cached = timelineIdCacheRef.current.get(key);
    if (cached) return cached;

    try {
      const resp = await postJSON<ListTimelinesLite>("/v1/boss-timelines");
      const found = (resp.items || []).find((it) => it.bossName === key);
      if (!found) return null;
      const id = String(found.id);
      timelineIdCacheRef.current.set(key, id);
      return id;
    } catch {
      return null;
    }
  }

  /** 비고정 next 계산(좌/중) */
  const { trackedIdSet, forgottenNextMap, allBossesSortedByNext } = useMemo(() => {
    const now = Date.now();
    const trackedIdSet = new Set(trackedRaw.map((b) => b.id));

    const forgottenNextMap = new Map<string, number>();
    for (const b of forgottenRaw) {
      if (!b.lastCutAt || !b.respawn || b.respawn <= 0) {
        forgottenNextMap.set(b.id, Number.POSITIVE_INFINITY);
        continue;
      }
      const lastMs = new Date(b.lastCutAt).getTime();
      if (!Number.isFinite(lastMs)) {
        forgottenNextMap.set(b.id, Number.POSITIVE_INFINITY);
        continue;
      }
      const step = Math.max(1, Math.round(b.respawn * 60 * 1000));
      const diff = now - lastMs;
      const k = Math.max(1, Math.ceil(diff / step));
      const nextMs = lastMs + k * step;
      forgottenNextMap.set(b.id, nextMs);
    }

    const all = [...trackedRaw, ...forgottenRaw];
    const seen = new Set<string>();
    const dedupAll = all.filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)));

    const getNext = (b: BossDto) => {
      if (trackedIdSet.has(b.id)) {
        if (b.nextSpawnAt) {
          const t = new Date(b.nextSpawnAt).getTime();
          if (Number.isFinite(t)) return t;
        }
        return lastNextSpawnRef.current.get(b.id) ?? Number.POSITIVE_INFINITY;
      }
      return forgottenNextMap.get(b.id) ?? Number.POSITIVE_INFINITY;
    };

    const allBossesSortedByNext = [...dedupAll].sort((a, b) => getNext(a) - getNext(b));
    return { trackedIdSet, forgottenNextMap, allBossesSortedByNext };
  }, [trackedRaw, forgottenRaw]);

  // 최신 참조용
  const trackedIdSetRef = useRef<Set<string>>(new Set());
  const forgottenNextMapRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    trackedIdSetRef.current = new Set(trackedIdSet);
    forgottenNextMapRef.current = new Map(forgottenNextMap);
  }, [trackedIdSet, forgottenNextMap]);

  /** 비고정 next ms */
  const getNextMsGeneric = (b: BossDto) => {
    if (trackedIdSetRef.current.has(b.id)) {
      if (b.nextSpawnAt) {
        const t = new Date(b.nextSpawnAt).getTime();
        if (Number.isFinite(t)) return t;
      }
      return lastNextSpawnRef.current.get(b.id) ?? Number.POSITIVE_INFINITY;
    }
    return forgottenNextMapRef.current.get(b.id) ?? Number.POSITIVE_INFINITY;
  };

  /** 검색(좌/중만) */
  const filteredAll = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allBossesSortedByNext;
    const tokens = q.split(/\s+/g);
    const match = (b: BossDto) => {
      const hay = `${b.name} ${b.location ?? ""}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    };
    return allBossesSortedByNext.filter(match);
  }, [query, allBossesSortedByNext]);

  /** 비고정: 남은/지남(ms) + 유예 설정 */
  const remainingMsFor = (b: BossDto) => {
    const now = Date.now();
    const nextMs = getNextMsGeneric(b);
    const overdueUntil = overdueUntilRef.current.get(b.id);

    if (overdueUntil && now < overdueUntil) {
      const overdueStart = overdueUntil - OVERDUE_GRACE_MS;
      return -(now - overdueStart);
    }
    if (!Number.isFinite(nextMs)) return Number.POSITIVE_INFINITY;

    const diff = nextMs - now;

    if (diff <= 0) {
      const target = nextMs + OVERDUE_GRACE_MS;
      const existing = overdueUntilRef.current.get(b.id);
      if (!existing || existing < target) {
        overdueUntilRef.current.set(b.id, target);
        writeOverdueMap(overdueUntilRef.current);
      }
      const overdueStart = (overdueUntilRef.current.get(b.id) ?? target) - OVERDUE_GRACE_MS;
      return -(now - overdueStart);
    }
    return diff;
  };

  /** 비고정: 유예 종료 처리 */
  useEffect(() => {
    const now = Date.now();
    const toFinalize: string[] = [];
    overdueUntilRef.current.forEach((until, id) => {
      if (now >= until) toFinalize.push(id);
    });
    if (toFinalize.length === 0) return;

    setMissCounts((prev) => {
      const next = { ...prev };
      for (const id of toFinalize) next[id] = (next[id] ?? 0) + 1;
      writeCounts(LS_MISS, next);
      return next;
    });

    let changed = false;
    for (const id of toFinalize) {
      const until = overdueUntilRef.current.get(id) ?? now;
      const startKey = until - OVERDUE_GRACE_MS;
      lastMissMarkedRef.current.set(id, startKey);
      overdueUntilRef.current.delete(id);
      missedWarnSetRef.current.delete(id);
      changed = true;
    }
    if (changed) writeOverdueMap(overdueUntilRef.current);
  }, [uiTick]);

  /** 비고정: 음성 알림(5/1분 전) + 지남 3분 경고 */
  const [alertedMap, setAlertedMap] = useState<Map<string, Set<number>>>(new Map());
  useEffect(() => {
    if (!voiceEnabled) return;

    const toSpeak: Array<{ id: string; name: string; threshold: number }> = [];
    const toWarnMissed: Array<{ id: string; name: string }> = [];

    for (const b of filteredAll) {
      const r = remainingMsFor(b);
      if (!(r > 0)) continue;
      const prev = alertedMap.get(b.id);
      for (const th of ALERT_THRESHOLDS) {
        if (r <= th && !(prev?.has(th))) toSpeak.push({ id: b.id, name: b.name, threshold: th });
      }
    }
    for (const b of filteredAll) {
      const r = remainingMsFor(b);
      if (r <= -MISSED_WARN_MS && r > -(MISSED_WARN_MS + 2 * MS)) {
        if (!missedWarnSetRef.current.has(b.id)) toWarnMissed.push({ id: b.id, name: b.name });
      }
    }

    if (toSpeak.length === 0 && toWarnMissed.length === 0) return;

    (async () => {
      for (const x of toSpeak) {
        const minStr = x.threshold === 5 * MIN ? "5분" : "1분";
        try { await speakKorean(`${x.name} 보스 젠 ${minStr} 전입니다.`); } catch { await playBeep(250); }
        await delay(100);
      }
      for (const x of toWarnMissed) {
        try { 
          for (const x of toWarnMissed) {
            try {
              await speakKorean(`${x.name} 처리하지 않으면 미입력 보스로 이동합니다.`);
            } catch {
              await playBeep(300);
            }
            await delay(100);
            missedWarnSetRef.current.add(x.id);
          }
         } catch { await playBeep(300); }
        await delay(100);
        missedWarnSetRef.current.add(x.id);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredAll, uiTick, voiceEnabled]);

  /** 공통 유틸 */
  function delay(ms: number) { return new Promise((res) => setTimeout(res, ms)); }
  function playBeep(durationMs = 300) {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return Promise.resolve();
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine"; osc.frequency.value = 880; gain.gain.value = 0.08;
    osc.connect(gain); gain.connect(ctx.destination); osc.start();
    return new Promise<void>((resolve) => {
      setTimeout(() => { osc.stop(); ctx.close().finally(() => resolve()); }, durationMs);
    });
  }
  function speakKorean(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ss: SpeechSynthesis | undefined = (window as any).speechSynthesis;
      if (!ss || typeof window === "undefined") return reject(new Error("speechSynthesis not available"));
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "ko-KR"; utter.rate = 1; utter.pitch = 1;
      const pickVoice = () => {
        const voices = ss.getVoices?.() || [];
        const ko = voices.find((v) => /ko[-_]KR/i.test(v.lang)) || voices.find((v) => v.lang?.startsWith("ko"));
        if (ko) utter.voice = ko; ss.speak(utter);
      };
      utter.onend = () => resolve(); utter.onerror = () => reject(new Error("speech error"));
      if (ss.getVoices && ss.getVoices().length > 0) pickVoice();
      else {
        const handler = () => { ss.onvoiceschanged = null as any; pickVoice(); };
        ss.onvoiceschanged = handler;
        setTimeout(() => { if (ss.onvoiceschanged === handler) { ss.onvoiceschanged = null as any; pickVoice(); } }, 500);
      }
    });
  }

  /** 좌/중 렌더 보조 */
  /** 남은/지남 시간을 H:MM:SS 형태로 포맷 (양수=ceil, 음수=floor) */
  function fmtHMS(ms: number): string | null {
    if (!Number.isFinite(ms)) return null;
    const negative = ms < 0;
    const t = Math.abs(ms);
    const totalSec = negative ? Math.floor(t / 1000) : Math.ceil(t / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

function LocationHover({ text, className = "" }: { text?: string | null; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: -9999, y: -9999 }); // 초기엔 화면 밖
  const rafRef = useRef<number | null>(null);

  const updatePos = useCallback((x: number, y: number) => {
    const off = 12; // 커서에서 약간 우하단
    const maxX = Math.max(0, window.innerWidth - 16);
    const maxY = Math.max(0, window.innerHeight - 16);
    const nx = Math.min(x + off, maxX);
    const ny = Math.min(y + off, maxY);

    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => {
        setPos({ x: nx, y: ny });
        rafRef.current = null;
      });
    }
  }, []);

  const handleMove = useCallback((e: MouseEvent) => {
    updatePos(e.clientX, e.clientY);
  }, [updatePos]);

  const onEnter = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    setOpen(true);
    updatePos(e.clientX, e.clientY);                // 진입 즉시 위치 지정(0,0 점프 방지)
    window.addEventListener("mousemove", handleMove);
  }, [handleMove, updatePos]);

  const onLeave = useCallback(() => {
    setOpen(false);
    window.removeEventListener("mousemove", handleMove);
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  }, [handleMove]);

  useEffect(() => {
    return () => { // 언마운트 안전 해제
      window.removeEventListener("mousemove", handleMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [handleMove]);

  return (
    <>
      <button
        type="button"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        className={`pointer-events-auto w-full rounded-md border text-[10px] leading-none
                    px-2 py-[3px] bg-white/80 text-slate-600 shadow-sm hover:bg-white ${className}`}
        // ⛔ title 제거(네이티브 까만 툴팁 방지)
        aria-label="젠 위치 보기"
      >
        위치
      </button>

      {open && !!text && (
        <div
          className="fixed z-[9999] pointer-events-none max-w-[60vw]
                     rounded-md border bg-white/95 px-2 py-1 text-[12px] text-slate-700
                     shadow-lg backdrop-blur-sm whitespace-pre-wrap break-keep"
          style={{ top: pos.y, left: pos.x }}
          role="tooltip"
        >
          {text}
        </div>
      )}
    </>
  );
}

function renderTile(b: BossDto, list: "left" | "middle" = "left") {
  const remain = remainingMsFor(b);
  const hms = fmtHMS(remain);

  const isSoon = remain > 0 && remain <= HIGHLIGHT_MS;
  const shouldBlink = isSoon || remain < 0;

  const blinkCls = shouldBlink
    ? "animate-blink border-2 border-rose-500 bg-rose-50"
    : "border border-slate-200 bg-white";

  const canDaze = !!b.isRandom;
  const dazeCount = Number((b as any)?.dazeCount ?? 0);
  const missCount = list === "middle" ? (missCounts[b.id] ?? 0) : 0;

  const afterLabel = remain < 0 ? "지남" : (list === "middle" ? "뒤 예상" : "뒤 젠");

  return (
    <div key={b.id} className={`relative rounded-xl shadow-sm p-3 text-sm ${blinkCls}`}>
      {/* 우측 상단 작은 뱃지 (이름과 겹쳐도 됨) */}
      <div className="pointer-events-none absolute top-1 right-1 z-10 flex flex-col items-end gap-[2px]">
        {dazeCount > 0 && (
          <span className="rounded-[6px] border border-amber-300 bg-amber-50/90 px-1.5 py-[1px] text-[10px] leading-none font-medium text-amber-700">
            멍 {dazeCount}
          </span>
        )}
        {missCount > 0 && list === "middle" && (
          <span className="rounded-[6px] border border-sky-300 bg-sky-50/90 px-1.5 py-[1px] text-[10px] leading-none font-medium text-sky-700">
            미입력 {missCount}
          </span>
        )}
      </div>

      {/* 1) 보스명 — 개행/생략 없음, 필요시 뱃지 위로 겹쳐서 전부 노출 */}
      <div className="relative z-20 font-medium text-[13px] leading-tight tracking-tight whitespace-nowrap">
        {b.name}
      </div>

      {/* 2) 타이머 — 개행 금지 */}
      <div className="text-xs text-slate-600 whitespace-nowrap">
        {hms == null ? (
          "미입력"
        ) : (
          <>
            {hms}
            <span className="ml-1">{afterLabel}</span>
          </>
        )}
      </div>

      {/* 3) 컷/멍 버튼 (간격 작게) */}
      <div className="mt-1 grid grid-cols-[auto_1fr_auto] items-center gap-1 pr-1">
        <button
          type="button"
          onClick={() => instantCut(b)}
          className="col-start-1 px-3 py-1.5 rounded-md text-xs text-white bg-slate-900 hover:opacity-90"
          aria-label="지금 시간으로 즉시 컷"
        >
          컷
        </button>

        <div className="col-start-2" />

        {canDaze ? (
          <button
            type="button"
            onClick={() => addDaze(b)}
            className="col-start-3 px-3 py-1.5 rounded-md text-xs border text-slate-700 hover:bg-slate-50"
            aria-label="멍 +1"
          >
            멍
          </button>
        ) : (
          <span className="col-start-3 px-3 py-1.5 rounded-md text-xs border opacity-0 select-none">멍</span>
        )}

        {/* 4) 위치 보기 — 한 줄 전체, 얇게 (LocationHover는 기존 것 사용) */}
        {b.location && (
          <div className="col-span-3 pt-1">
            <LocationHover text={b.location} />
          </div>
        )}
      </div>
    </div>
  );
}

  /** 리스트를 '곧(≤5분)'과 나머지로 분리 (작은 타일만 사용) */
  function splitSoonWithin5m(list: BossDto[]) {
    const now = Date.now();
    const soon: BossDto[] = [];
    const rest: BossDto[] = [];

    for (const b of list) {
      const remain = remainingMsFor(b);
      const overdueUntil = overdueUntilRef.current.get(b.id);
      const isOverKeep = !!overdueUntil && now < overdueUntil;
      const isSoon = remain > 0 && remain <= HIGHLIGHT_MS && !isOverKeep;
      if (isSoon) soon.push(b);
      else rest.push(b);
    }
    return { soon, rest };
  }

  /** 좌측(진행중) */
  const leftTracked = useMemo(() => {
    const now = Date.now();
    const withKey = filteredAll.map((b) => {
      const next = getNextMsGeneric(b);
      const overdueUntil = overdueUntilRef.current.get(b.id);
      const isOverKeep = overdueUntil != null && now < overdueUntil;
      const key = isOverKeep ? 0 : Number.isFinite(next) ? Math.max(next - now, 0) : Number.POSITIVE_INFINITY;
      return { b, key };
    });

    return withKey
      .filter(({ b }) => (missCounts[b.id] ?? 0) === 0 && hasAnyRecord(b))
      .sort((a, z) => a.key - z.key)
      .map(({ b }) => b);
  }, [filteredAll, missCounts, uiTick]);

  /** 중앙(미입력) — 지남 보스는 항상 최상단 + 깜빡임 유지 */
  const middleTracked = useMemo(() => {
    const now = Date.now();

    return filteredAll
      // 미입력 섹션에 들어갈 보스만 남김: 미입력 카운트>0 이거나, 기록 자체가 없는 보스
      .filter((b) => (missCounts[b.id] ?? 0) > 0 || !hasAnyRecord(b))
      .map((b) => {
        const remain = remainingMsFor(b);
        // 정렬 키 산정
        // 1) 지남: 최우선 상단 (음수 큰 우선순위)
        // 2) 남아있음: 남은 시간 오름차순
        // 3) 미입력(= remain === Infinity): 가장 아래쪽으로 보내기 위해 매우 큰 유한값
        const sortKey =
          remain < 0
            ? -999999
            : Number.isFinite(remain)
            ? remain
            : 9e15; // <- Infinity 대신 큰 유한값으로 하단 배치
        return { b, sortKey };
      })
      .sort((a, z) => a.sortKey - z.sortKey)
      .map(({ b }) => b);
  }, [filteredAll, missCounts, uiTick]);

  /** ───────── 우측: 고정 보스(05시 기준 사이클) ───────── */

  // 분(0~1439) → "HH:mm"
  function fmtDaily(genTime: unknown) {
    const n = genTime == null ? NaN : Number(genTime);
    if (!Number.isFinite(n)) return "—";
    const m = Math.max(0, Math.min(1439, Math.floor(n)));
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  function cycleStartMs(nowMs = Date.now()) {
    const d = new Date(nowMs);
    const base = new Date(d);
    base.setSeconds(0, 0);
    if (d.getHours() >= 5) base.setHours(5, 0, 0, 0);
    else { base.setDate(base.getDate() - 1); base.setHours(5, 0, 0, 0); }
    return base.getTime();
  }
  function nextCycleStartMs(curStartMs: number) { return curStartMs + DAY; }

  function fixedOccMs(genTime: unknown, nowMs = Date.now()) {
    const n = genTime == null ? NaN : Number(genTime);
    if (!Number.isFinite(n)) return Number.POSITIVE_INFINITY;
    const start = cycleStartMs(nowMs);
    const offsetMin = ((Math.floor(n) - 300 + 1440) % 1440);
    return start + offsetMin * MIN;
  }
  function lastOccMs(nowMs = Date.now()) { return fixedOccMs(0, nowMs); }
  function isPostLastWindow(nowMs = Date.now()) {
    const start = cycleStartMs(nowMs);
    const last = lastOccMs(nowMs);
    const end = nextCycleStartMs(start);
    return nowMs >= last && nowMs < end;
  }
  function fixedIsCaughtCycle(f: FixedBossDto, nowMs = Date.now()) {
    if (isPostLastWindow(nowMs)) return true;
    if (!f.lastCutAt || f.genTime == null || !Number.isFinite(f.genTime)) return false;
    const occ = fixedOccMs(f.genTime, nowMs);
    const cut = new Date(f.lastCutAt).getTime();
    const cycleStart = cycleStartMs(nowMs);
    const cycleEnd = nextCycleStartMs(cycleStart);
    return cut >= occ && cut < cycleEnd;
  }

  const fixedSorted = useMemo(() => {
    const now = Date.now();

    type Row = {
      f: FixedBossDto;
      group: number;  // 0=지남<5m(빨강 상단 고정), 1=곧/대기(정상 정렬), 2=완료/지남>5m(하단)
      key: number;
    };

    const rows: Row[] = fixedRaw.map((f) => {
      const remain = fixedRemainMs(f, now);                // >0: 남음, <0: 지남
      const overdueKeep = remain < 0 && remain >= -OVERDUE_GRACE_MS; // 지남~5분 유예
      const soon = remain > 0 && remain <= HIGHLIGHT_MS;   // 5분 이내
      const caught = fixedIsCaughtCycle(f, now);           // 이번 사이클 이미 잡힘(파랑)
      const postLast = isPostLastWindow(now);              // 00~05시 전체 파랑
      const afterGrace = remain <= -OVERDUE_GRACE_MS;      // 지남 5분 초과

      // 파랑: 잡힘이거나(또는 00~05시) 혹은 지남 5분 초과
      const isBlue = caught || postLast || afterGrace;

      // 그룹 결정
      let group = 1;
      if (overdueKeep) group = 0;
      else if (isBlue) group = 2;

      // 정렬 키
      let key: number;
      if (group === 0) key = Math.abs(remain);
      else if (group === 1) key = Number.isFinite(remain) ? remain : Number.POSITIVE_INFINITY;
      else key = fixedOccMs(f.genTime, now);

      return { f, group, key };
    });

    rows.sort((a, b) => {
      if (a.group !== b.group) return a.group - b.group;
      if (a.f.id === "18" && b.f.id !== "18") return 1;
      if (b.f.id === "18" && a.f.id !== "18") return -1;
      return a.key - b.key;
    });

    return rows.map((r) => r.f);
  }, [fixedRaw, uiTick]);

  const nextTargetId = useMemo(() => {
    const now = Date.now();
    let bestId: string | null = null;
    let bestMs = Number.POSITIVE_INFINITY;
    for (const f of fixedSorted) {
      if (f.id === "18") continue;
      if (fixedIsCaughtCycle(f, now)) continue;
      const n = fixedOccMs(f.genTime, now);
      if (n < bestMs) { bestMs = n; bestId = f.id; }
    }
    return bestId;
  }, [fixedSorted, uiTick]);

  useEffect(() => {
    if (!voiceEnabled || fixedSorted.length === 0) return;

    const now = Date.now();
    const curStart = cycleStartMs(now);
    if (fixedCycleStartRef.current !== curStart) {
      fixedAlertedMapRef.current = new Map();
      fixedCycleStartRef.current = curStart;
    }

    const toSpeak: Array<{ id: string; name: string; threshold: number }> = [];

    for (const f of fixedSorted) {
      const occ = fixedOccMs(f.genTime, now);
      if (!Number.isFinite(occ)) continue;
      const remain = occ - now;
      if (!(remain > 0)) continue;
      if (occ >= nextCycleStartMs(curStart)) continue;

      const prev = fixedAlertedMapRef.current.get(f.id);
      for (const th of ALERT_THRESHOLDS) {
        if (remain <= th && !(prev?.has(th))) {
          toSpeak.push({ id: f.id, name: f.name, threshold: th });
        }
      }
    }

    if (toSpeak.length === 0) return;

    (async () => {
      for (const x of toSpeak) {
        const minStr = x.threshold === 5 * MIN ? "5분" : "1분";
        try { await speakKorean(`${x.name} 보스 젠 ${minStr} 전입니다.`); } catch { await playBeep(250); }
        await delay(100);
      }
    })().catch(() => {});

    for (const x of toSpeak) {
      const set = fixedAlertedMapRef.current.get(x.id) ?? new Set<number>();
      set.add(x.threshold);
      fixedAlertedMapRef.current.set(x.id, set);
    }
  }, [fixedSorted, uiTick, voiceEnabled]);

  /** 좌/중: 간편 컷 입력 파싱 */
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
    const boss = list.find((b) => hay(b).includes(nameQuery));
    if (!boss) return { boss: null, iso: null };

    const d = new Date();
    d.setSeconds(0, 0);
    d.setHours(hh, mm, 0, 0);
    const iso = d.toISOString();

    return { boss, iso };
  }

  /** 좌/중: 간편 컷 저장 */
  async function submitQuickCut() {
    if (quickSaving) return;
    const parsed = parseQuickCut(quickCutText, filteredAll);
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

      // 컷 → miss 리셋 + 유예 해제(멍 카운트는 새 타임라인 생성으로 서버에서 0)
      setMissCounts((prev) => {
        const next = { ...prev, [parsed.boss!.id]: 0 };
        writeCounts(LS_MISS, next);
        return next;
      });
      overdueUntilRef.current.delete(parsed.boss.id);
      missedWarnSetRef.current.delete(parsed.boss.id);
      lastMissMarkedRef.current.delete(parsed.boss.id);
      writeOverdueMap(overdueUntilRef.current);

      setQuickCutText("");
      await loadBosses();
    } catch (e: any) {
      alert(e?.message ?? "간편컷 저장 실패");
    } finally {
      setQuickSaving(false);
    }
  }

  /** 좌/중: 즉시 컷 */
  async function instantCut(b: BossDto) {
    try {
      await postJSON(`/v1/dashboard/bosses/${b.id}/cut`, {
        cutAtIso: new Date().toISOString(),
        mode: "TREASURY",
        items: [],
        participants: [],
      });
      setMissCounts((prev) => {
        const next = { ...prev, [b.id]: 0 };
        writeCounts(LS_MISS, next);
        return next;
      });
      overdueUntilRef.current.delete(b.id);
      missedWarnSetRef.current.delete(b.id);
      lastMissMarkedRef.current.delete(b.id);
      writeOverdueMap(overdueUntilRef.current);
      await loadBosses();
    } catch (e: any) {
      alert(e?.message ?? "즉시 컷 실패");
    }
  }

  /** 좌/중: 멍(+1) — 서버 성공 후에만 로컬 상태 정리 */
  async function addDaze(b: BossDto) {
    try {
      const timelineId = await getTimelineIdForBossName(b.name);
      if (!timelineId) {
        alert("해당 보스의 최근 컷 타임라인을 찾을 수 없습니다.");
        return;
      }
      await postJSON(`/v1/boss-timelines/${timelineId}/daze`, { atIso: new Date().toISOString() });

      // 멍 처리되면 미입력 카운트/유예는 초기화
      setMissCounts((prev) => {
        const next = { ...prev, [b.id]: 0 };
        writeCounts(LS_MISS, next);
        return next;
      });
      overdueUntilRef.current.delete(b.id);
      missedWarnSetRef.current.delete(b.id);
      lastMissMarkedRef.current.delete(b.id);
      writeOverdueMap(overdueUntilRef.current);

      // 서버에서 최신 dazeCount(=최근 타임라인 noGenCount)가 반영된 목록 재로드
      await loadBosses();
    } catch {
      alert("멍 기록에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  /** JSX */
  return (
    <div className="h-[calc(100dvh-56px)] min-h-0 overflow-hidden grid grid-rows-[auto_1fr] gap-3">
      {/* 상단바 */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* 검색(좌/중만) */}
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

        {/* 음성 알림 */}
        <label className="flex items-center gap-2 text-sm select-none">
          <input type="checkbox" checked={voiceEnabled} onChange={(e) => setVoiceEnabled(e.currentTarget.checked)} />
          음성 알림
        </label>

        {/* 간편 컷 */}
        <div className="flex items-center gap-2">
          <input
            className="border rounded-xl px-3 py-2 w-[280px]"
            placeholder="간편 보스 컷: 2200 서드"
            value={quickCutText}
            onChange={(e) => setQuickCutText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); submitQuickCut(); }
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

      {/* 본문 3컬럼 */}
      <div className="min-h-0 overflow-hidden grid grid-cols-3 gap-4">
        {/* 좌측: 진행중(비고정) */}
        <section className="col-span-1 min-h-0 overflow-y-auto px-1">
          <h2 className="text-base font-semibold mb-2 text-slate-700">
            진행중 보스타임
            {query ? <span className="ml-2 text-xs text-slate-400">({leftTracked.length}개)</span> : null}
          </h2>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {loading ? (
              <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-500">불러오는 중…</div>
            ) : leftTracked.length === 0 ? (
              <div className="mt-3 h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-400 italic">
                {query ? "검색 결과가 없습니다." : "스케줄 추적 중인 보스가 없습니다."}
              </div>
            ) : (
              (() => {
                const { soon, rest } = splitSoonWithin5m(leftTracked);
                const merged = [...soon, ...rest]; // 한 그리드에 합치기
                return (
                  <div className="grid grid-cols-3 gap-3">
                    {merged.map((b) => renderTile(b, "left"))}
                  </div>
                );
              })()
            )}
          </div>
        </section>

        {/* 중앙: 미입력(비고정) */}
        <section className="col-span-1 h-full min-h-0 flex flex-col px-1">
          <h2 className="text-base font-semibold mb-2 text-slate-700">
            미입력된 보스
            {query ? <span className="ml-2 text-xs text-slate-400">({middleTracked.length}개)</span> : null}
          </h2>

        <div className="flex-1 min-h-0 overflow-y-auto">
            {loading ? (
              <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-500">불러오는 중…</div>
            ) : middleTracked.length === 0 ? (
              <div className="mt-3 h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-400 italic">
                {query ? "검색 결과가 없습니다." : "미입력된 보스가 없습니다."}
              </div>
            ) : (
              (() => {
                const { soon, rest } = splitSoonWithin5m(middleTracked);
                const merged = [...soon, ...rest];
                return (
                  <div className="grid grid-cols-3 gap-3">
                    {merged.map((b) => renderTile(b, "middle"))}
                  </div>
                );
              })()
            )}
          </div>
        </section>

        {/* 우측: 고정 보스(05시 리셋, 00:00 이후 전부 파랑) */}
        <section className="col-span-1 min-h-0 overflow-y-auto px-1">
          <h2 className="text-base font-semibold mb-2 text-slate-700">고정 보스</h2>
          <div className="space-y-3">
            {loading ? (
              <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-500">불러오는 중…</div>
            ) : fixedSorted.length === 0 ? (
              <div className="mt-3 h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-400 italic">
                고정 보스가 없습니다.
              </div>
            ) : (
              fixedSorted.map((fb) => {
                const now = Date.now();
                const remain = fixedRemainMs(fb, now);                 // +: 남음, -: 지남
                const overdueKeep = remain < 0 && remain >= -OVERDUE_GRACE_MS;
                const soon = remain > 0 && remain <= HIGHLIGHT_MS;
                const afterGrace = remain <= -OVERDUE_GRACE_MS;
                const isCaught = fixedIsCaughtCycle(fb, now);
                const postLast = isPostLastWindow(now);

                // 스타일 결정
                const isBlue = isCaught || postLast || afterGrace;           // 파랑 상태
                const isRed = soon || overdueKeep;                           // 빨강 상태(깜빡)
                const wrapClass =
                  isRed
                    ? "relative rounded-xl border shadow-sm p-3 text-sm ring-2 ring-rose-400 bg-rose-50/60 animate-blink"
                    : isBlue
                    ? "relative rounded-xl border shadow-sm p-3 text-sm ring-2 ring-sky-300 bg-sky-50/60"
                    : "relative rounded-xl border shadow-sm p-3 text-sm bg-white";

                // 5분 전부터 우하단 카운트(mm:ss 남음)
                const showCountdown = remain > 0 && remain <= HIGHLIGHT_MS;
                const countdownBadge = showCountdown ? (
                  <span className="pointer-events-none absolute right-2 bottom-2 z-20 text-[11px] px-2 py-0.5 rounded-md border bg-white/90 backdrop-blur-sm shadow-sm">
                    {fmtMMSS2(remain)} 남음
                  </span>
                ) : null;

                return (
                  <div key={fb.id} className={wrapClass}>
                    {countdownBadge}
                    <div className="flex items-center justify-between">
                      <div className="font-medium truncate">{fb.name}</div>
                      <div className="text-xs text-slate-500 ml-2">{fb.location}</div>
                    </div>
                    <div className="mt-1 text-xs text-slate-600">
                      젠 시각: <span className="font-semibold">{fmtDaily(fb.genTime)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
