import { useState, useEffect, useMemo, useRef } from "react";
import { postJSON } from "@/lib/http";
import BossCard from "./BossCard";
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
const LS_DAZE = "bossDazeCounts";
const LS_MISS = "bossMissCounts";
const LS_OVERDUE_UNTIL = "bossOverdueUntil";

/** ───────── 타입 ───────── */
type FixedBossDto = {
  id: string;
  name: string;
  location: string;
  genTime: number | null;   // 0~1439 (HH*60+mm) — DB 필드명: genTime(분 단위)
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

  /** 로컬 카운트(멍/미입력) */
  const [dazeCounts, setDazeCounts] = useState<CountMap>(() => readCounts(LS_DAZE));
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

  /** 서버 로드 */
  async function loadBosses() {
    setLoading(true);
    try {
      // 백엔드가 {tracked, forgotten, fixed} 반환
      const data = await postJSON<any>("/v1/dashboard/bosses");
      setTrackedRaw(data.tracked ?? []);
      setForgottenRaw(data.forgotten ?? []);
      setFixedRaw(
        ((data.fixed ?? []) as any[]).map((f) => ({
          ...f,
          genTime: f.genTime == null ? null : Number(f.genTime), // ← 숫자로 강제
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

  /** 기록 존재 여부(좌/중) */
  const hasAnyRecord = (b: BossDto) => {
    const daze = dazeCounts[b.id] ?? 0;
    return !!b.lastCutAt || daze > 0;
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

    // 5/1분 전
    for (const b of filteredAll) {
      const r = remainingMsFor(b);
      if (!(r > 0)) continue;
      const prev = alertedMap.get(b.id);
      for (const th of ALERT_THRESHOLDS) {
        if (r <= th && !(prev?.has(th))) toSpeak.push({ id: b.id, name: b.name, threshold: th });
      }
    }
    // 지남 3분 경고(유예 중)
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
        try { await speakKorean(`컷 이나 멍 처리 하지 않으면 미입력 보스로 이동합니다.`); } catch { await playBeep(300); }
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
  function fmtMMSS(ms: number) {
    const isOver = ms < 0;
    const secs = Math.max(0, isOver ? Math.floor(-ms / 1000) : Math.ceil(ms / 1000));
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  function rightTimerBadge(remain: number, isOverdueKeep: boolean) {
    const nowOver = remain < 0 || isOverdueKeep;
    const abs = Math.abs(remain);
    const within5m = abs <= 5 * MIN;
    if (!within5m) return null;
    const mmss = fmtMMSS(remain);
    const label = !nowOver ? `${mmss} 남음` : `${mmss} 지남`;
    return (
      <span className="pointer-events-none absolute right-2 top-2 z-20 text-[11px] px-2 py-0.5 rounded-md border bg-white/80 backdrop-blur-sm shadow-sm">
        {label}
      </span>
    );
  }
  const highlightSoonWrap = "relative rounded-xl ring-2 ring-rose-300 bg-rose-50/60 transition-colors";
  const highlightOverWrap = "relative rounded-xl ring-2 ring-sky-300 bg-sky-50/60 transition-colors";

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
  }, [filteredAll, missCounts, dazeCounts, uiTick]);

  /** 중앙(미입력) */
  const middleTracked = useMemo(() => {
    const now = Date.now();
    const withKey = filteredAll.map((b) => {
      const next = getNextMsGeneric(b);
      const key = Number.isFinite(next) ? Math.max(next - now, 0) : Number.POSITIVE_INFINITY;
      return { b, key };
    });

    return withKey
      .filter(({ b }) => (missCounts[b.id] ?? 0) > 0 || !hasAnyRecord(b))
      .sort((a, z) => a.key - z.key)
      .map(({ b }) => b);
  }, [filteredAll, missCounts, dazeCounts, uiTick]);

  /** 카드 렌더(좌/중) */
  const renderCard = (b: BossDto, section: "left" | "middle") => {
    const remain = remainingMsFor(b);
    const overdueUntil = overdueUntilRef.current.get(b.id);
    const now = Date.now();
    const isOverdueKeep = !!overdueUntil && now < overdueUntil;

    const soon = remain <= HIGHLIGHT_MS && remain > 0 && !isOverdueKeep;
    const justOver = isOverdueKeep || remain < 0;
    const wrapClass = soon ? highlightSoonWrap : justOver ? highlightOverWrap : "relative";

    const topRight = rightTimerBadge(remain, isOverdueKeep);

    // ✅ isRandom(= 멍 가능 여부) 보스만 멍 버튼/카운트 노출
    const canDaze = !!b.isRandom;

    return (
      <div key={b.id} className={wrapClass}>
        {topRight}
        <div className="pt-8">
          <BossCard
            b={b}
            onQuickCut={instantCut}
            onDaze={canDaze ? addDaze : undefined}                        // ← 보스별로 멍 버튼 토글
            showCount={
              section === "middle"
                ? "miss"                                                // 중앙은 계속 미입력 카운트 보여줌
                : canDaze
                ? "daze"                                                // 좌측 + 멍 가능 보스만 멍 카운트
                : undefined                                             // 좌측 + 멍 불가면 카운트 숨김
            }
            dazeCount={canDaze && section === "left" ? (dazeCounts[b.id] ?? 0) : undefined}
            missCount={section === "middle" ? (missCounts[b.id] ?? 0) : undefined}
          />
        </div>
      </div>
    );
  };

  /** ───────── 우측: 고정 보스(05시 기준 사이클) ───────── */

  // 분(0~1439) → "HH:mm"
  function fmtDaily(genTime: unknown) {
    const n = genTime == null ? NaN : Number(genTime);       // ← 방어 캐스팅
    if (!Number.isFinite(n)) return "—";
    const m = Math.max(0, Math.min(1439, Math.floor(n)));
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  // 게임일 시작(05:00)
  function cycleStartMs(nowMs = Date.now()) {
    const d = new Date(nowMs);
    const base = new Date(d);
    base.setSeconds(0, 0);
    if (d.getHours() >= 5) base.setHours(5, 0, 0, 0);   // 오늘 05:00
    else { base.setDate(base.getDate() - 1); base.setHours(5, 0, 0, 0); } // 어제 05:00
    return base.getTime();
  }
  function nextCycleStartMs(curStartMs: number) {
    return curStartMs + DAY;
  }

  // 고정 보스: 이번 사이클 발생 시각(ms)
  function fixedOccMs(genTime: unknown, nowMs = Date.now()) {
    const n = genTime == null ? NaN : Number(genTime);       // ← 방어 캐스팅
    if (!Number.isFinite(n)) return Number.POSITIVE_INFINITY;
    const start = cycleStartMs(nowMs);
    const offsetMin = ((Math.floor(n) - 300 + 1440) % 1440); // 05:00을 0으로 보정
    return start + offsetMin * MIN;
  }
  // 마지막 보스(00:00)의 이번 사이클 발생 시각
  function lastOccMs(nowMs = Date.now()) {
    return fixedOccMs(0, nowMs);
  }
  // 00:00 이후~05:00 이전 → 전부 파랑
  function isPostLastWindow(nowMs = Date.now()) {
    const start = cycleStartMs(nowMs);
    const last = lastOccMs(nowMs);
    const end = nextCycleStartMs(start);
    return nowMs >= last && nowMs < end;
  }
  // 이번 사이클에서 잡힘(파랑) 판정
  function fixedIsCaughtCycle(f: FixedBossDto, nowMs = Date.now()) {
    if (isPostLastWindow(nowMs)) return true; // 00:00 이후~05:00 전은 전부 파랑
    if (!f.lastCutAt || f.genTime == null || !Number.isFinite(f.genTime)) return false;
    const occ = fixedOccMs(f.genTime, nowMs);
    const cut = new Date(f.lastCutAt).getTime();
    const cycleStart = cycleStartMs(nowMs);
    const cycleEnd = nextCycleStartMs(cycleStart);
    return cut >= occ && cut < cycleEnd;
  }

  // 고정 정렬(다음 발생 순서, id=18은 항상 최하단)
  const fixedSorted = useMemo(() => {
    const arr = [...fixedRaw];
    const now = Date.now();
    arr.sort((a, b) => {
      if (a.id === "18" && b.id !== "18") return 1;
      if (b.id === "18" && a.id !== "18") return -1;
      const av = fixedOccMs(a.genTime, now);
      const bv = fixedOccMs(b.genTime, now);
      return av - bv;
    });
    return arr;
  }, [fixedRaw, uiTick]);

  // 다음 잡아야 할 보스(빨강): 아직 안 잡힌, id!=18 중 가장 이른 발생
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

  // 고정 보스 5/1분 전 음성 안내(05:00 기준 리셋)
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
      if (!(remain > 0)) continue;                // 지난 건 제외
      if (occ >= nextCycleStartMs(curStart)) continue; // 사이클 밖 제외

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

    // 상태 저장
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

      // 컷 → miss/daze 리셋 + 유예 해제
      setMissCounts((prev) => {
        const next = { ...prev, [parsed.boss!.id]: 0 };
        writeCounts(LS_MISS, next);
        return next;
      });
      setDazeCounts((prev) => {
        const next = { ...prev, [parsed.boss!.id]: 0 };
        writeCounts(LS_DAZE, next);
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
      setDazeCounts((prev) => {
        const next = { ...prev, [b.id]: 0 };
        writeCounts(LS_DAZE, next);
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

  /** 좌/중: 멍(+1) */
  async function addDaze(b: BossDto) {
    const prevDaze = dazeCounts[b.id] ?? 0;
    const prevMiss = missCounts[b.id] ?? 0;

    // 낙관적 반영
    setDazeCounts((prev) => {
      const next = { ...prev, [b.id]: prevDaze + 1 };
      writeCounts(LS_DAZE, next);
      return next;
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

    // 서버 기록
    const timelineId = await getTimelineIdForBossName(b.name);
    if (!timelineId) {
      // 롤백
      setDazeCounts((prev) => {
        const next = { ...prev, [b.id]: prevDaze };
        writeCounts(LS_DAZE, next);
        return next;
      });
      setMissCounts((prev) => {
        const next = { ...prev, [b.id]: prevMiss };
        writeCounts(LS_MISS, next);
        return next;
      });
      alert("해당 보스의 최근 컷 타임라인을 찾을 수 없습니다.");
      return;
    }

    const url = `/v1/boss-timelines/${timelineId}/daze`;
    try {
      await postJSON(url, { atIso: new Date().toISOString() });
    } catch {
      // 롤백
      setDazeCounts((prev) => {
        const next = { ...prev, [b.id]: prevDaze };
        writeCounts(LS_DAZE, next);
        return next;
      });
      setMissCounts((prev) => {
        const next = { ...prev, [b.id]: prevMiss };
        writeCounts(LS_MISS, next);
        return next;
      });
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
          <div className="space-y-2">
            {loading ? (
              <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-500">불러오는 중…</div>
            ) : leftTracked.length === 0 ? (
              <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-400 italic">
                {query ? "검색 결과가 없습니다." : "스케줄 추적 중인 보스가 없습니다."}
              </div>
            ) : (
              leftTracked.map((b) => renderCard(b, "left"))
            )}
          </div>
        </section>

        {/* 중앙: 미입력(비고정) */}
        <section className="col-span-1 min-h-0 overflow-y-auto px-1">
          <h2 className="text-base font-semibold mb-2 text-slate-700">
            미입력된 보스
            {query ? <span className="ml-2 text-xs text-slate-400">({middleTracked.length}개)</span> : null}
          </h2>
          <div className="space-y-2">
            {loading ? (
              <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-500">불러오는 중…</div>
            ) : middleTracked.length === 0 ? (
              <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-400 italic">
                {query ? "검색 결과가 없습니다." : "미입력된 보스가 없습니다."}
              </div>
            ) : (
              middleTracked.map((b) => renderCard(b, "middle"))
            )}
          </div>
        </section>

        {/* 우측: 고정 보스(05시 리셋, 00:00 이후 전부 파랑) */}
        <section className="col-span-1 min-h-0 overflow-y-auto px-1">
          <h2 className="text-base font-semibold mb-2 text-slate-700">고정 보스</h2>
          <div className="space-y-2">
            {loading ? (
              <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-500">불러오는 중…</div>
            ) : fixedSorted.length === 0 ? (
              <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-400 italic">
                고정 보스가 없습니다.
              </div>
            ) : (
              fixedSorted.map((fb) => {
                const now = Date.now();
                const isCaught = fixedIsCaughtCycle(fb, now);
                const isNext = !isCaught && fb.id === nextTargetId && !isPostLastWindow(now);
                const wrapClass = isCaught
                  ? "rounded-xl border shadow-sm p-3 text-sm ring-2 ring-sky-300 bg-sky-50/60"   // 잡힘=파랑
                  : isNext
                  ? "rounded-xl border shadow-sm p-3 text-sm ring-2 ring-rose-300 bg-rose-50/60" // 다음=빨강
                  : "rounded-xl border shadow-sm p-3 text-sm bg-white";
                return (
                  <div key={fb.id} className={wrapClass}>
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
