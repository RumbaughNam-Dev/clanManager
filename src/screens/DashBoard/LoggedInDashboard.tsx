import type React from "react";
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
// 비고정: 지남 3분째 경고 음성(한 번만)
const MISSED_WARN_MS = 3 * MIN;

/** 배지 오버레이 위치(카드 기준 비율) */
const BADGE_LEFT = "80%";      // 폭 4/5 지점
const BADGE_TOP  = "33.333%";  // 높이 1/3 지점

/** ───────── 타입 ───────── */
type FixedBossDto = {
  id: string;
  name: string;
  location: string;
  genTime: number | null;   // 0~1439 (HH*60+mm)
  respawn: number;
  isRandom: boolean;
  lastCutAt: string | null;
};

type CountMap = Record<string, number>;

/** ───────── 유틸 ───────── */

// mm:ss
function fmtMMSS2(ms: number) {
  const pos = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(pos / 60);
  const s = pos % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

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

// 분(0~1439) → "HH:mm"
function fmtDaily(genTime: unknown) {
  const n = genTime == null ? NaN : Number(genTime);
  if (!Number.isFinite(n)) return "—";
  const m = Math.max(0, Math.min(1439, Math.floor(n)));
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
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
  const missedWarnSetRef = useRef<Set<string>>(new Set());
  const timelineIdCacheRef = useRef<Map<string, string>>(new Map());

  /** 고정 보스 음성 알림 상태 (게임일 단위 리셋) */
  const fixedAlertedMapRef = useRef<Map<string, Set<number>>>(new Map());
  const fixedCycleStartRef = useRef<number>(0); // 현재 게임일 시작 ms(05:00 기준)

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

      // 비고정: 서버 nextSpawnAt 최신값 캐시(메모리만)
      const now = Date.now();
      const prevMap = lastNextSpawnRef.current;
      const nextMap = new Map(prevMap);

      for (const b of (data.tracked ?? []) as BossDto[]) {
        const newMs = b.nextSpawnAt ? new Date(b.nextSpawnAt).getTime() : NaN;
        if (Number.isFinite(newMs)) nextMap.set(b.id, newMs as number);
      }
      lastNextSpawnRef.current = nextMap;

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

  /** ───────── 미입력 계산식 (DB 우선) ─────────
   * 규칙:
   *  - 서버 lastCutAt이 있으면 미입력=0 (브라우저 상태와 무관, DB 우선)
   *  - lastCutAt이 없고 respawn > 0인 비고정 보스: 오늘 00:00을 기준으로 (now - 자정)/respawn 으로 주기 경과 수 산출
   *  - lastCutAt이 없고 respawn이 없거나 0: 미입력 계산 불가 → 0 처리(목록 존재만 표시)
   */
  function computeEffectiveMiss(b: BossDto, now = Date.now()): number {
    if (b.lastCutAt) return 0;
    const respawnMin = Number(b.respawn ?? 0);
    if (!b.isRandom || respawnMin <= 0) return 0; // 고정/잘못된 데이터는 미입력 카운트 0
    const sinceMidnight = (() => {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();
    const elapsedMin = (now - sinceMidnight) / 60000;
    return Math.max(0, Math.floor(elapsedMin / respawnMin));
  }

  /** 비고정: 남은/지남(ms) + 유예(5분) — 로컬스토리지 없이 계산만 */
  const remainingMsFor = (b: BossDto) => {
    const now = Date.now();
    const nextMs = getNextMsGeneric(b);

    if (!Number.isFinite(nextMs)) return Number.POSITIVE_INFINITY;

    const diff = nextMs - now;

    // 유예: next~next+5분 구간은 음수 시간(지남)으로 카운트다운 표시
    if (diff <= 0 && diff >= -OVERDUE_GRACE_MS) {
      return diff; // (-)로 내려감
    }
    return diff;
  };

  /** 비고정: 음성 알림(5/1분 전) + 지남 3분 경고(한 번) */
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
          await speakKorean(`${x.name} 처리하지 않으면 미입력 보스로 이동합니다.`);
        } catch {
          await playBeep(300);
        }
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
function LocationHover({ text }: { text?: string | null }) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const tipIdRef = useRef("boss-loc-tip-" + Math.random().toString(36).slice(2));
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 });

  const placeTooltip = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const gap = 8;
    let top = rect.top - 8;          // 버튼 위쪽에
    let left = rect.right + gap;     // 오른쪽 바깥
    // 화면 밖 방지
    const vw = window.innerWidth, vh = window.innerHeight;
    const TIP_W = 200; // 대략치 (필요시 조정)
    if (left > vw - TIP_W) left = rect.left - gap - TIP_W; // 좌측으로 뒤집기
    if (top < 8) top = rect.bottom + gap;                   // 아래로
    setPos({ top, left });
  }, []);

  const openTooltip = useCallback(() => {
    if (!text) return;
    placeTooltip();
    setOpen(true);
  }, [placeTooltip, text]);

  const closeTooltip = useCallback(() => setOpen(false), []);

  const onBtnEnter = useCallback(() => {
    openTooltip();
  }, [openTooltip]);

  const onBtnLeave = useCallback((e: React.MouseEvent) => {
    const to = e.relatedTarget as Node | null;
    const tip = document.getElementById(tipIdRef.current);
    if (tip && to && tip.contains(to)) return; // 툴팁으로 이동 시 닫지 않음
    closeTooltip();
  }, [closeTooltip]);

  // 툴팁에서 hover 유지: 버튼에서 벗어나도 닫히지 않음
  const onTipEnter = useCallback(() => setOpen(true), []);
  const onTipLeave = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => placeTooltip();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, placeTooltip]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onMouseEnter={onBtnEnter}
        onMouseLeave={onBtnLeave}
        className="pointer-events-auto w-full rounded-md border text-[10px] leading-none px-2 py-[3px] bg-white/80 text-slate-600 shadow-sm hover:bg-white relative z-[70]"
      >
        보스 젠 위치
      </button>

      {open && !!text && (
        <div
          id={tipIdRef.current}
          onMouseEnter={onTipEnter}
          onMouseLeave={onTipLeave}
          className="fixed z-[100000] pointer-events-auto max-w-[60vw]
                     rounded-md border bg-white/95 px-2 py-1 text-[12px] text-slate-700
                     shadow-lg backdrop-blur-sm whitespace-pre-wrap break-keep"
          style={{ top: pos.top, left: pos.left, width: 200 }}
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
    const shouldBlink = isSoon || (remain < 0 && remain >= -OVERDUE_GRACE_MS);

    const blinkCls = shouldBlink
      ? "animate-blink border-2 border-rose-500 bg-rose-50"
      : "border border-slate-200 bg-white";

    const canDaze = !!b.isRandom;
    const dazeCount = Number((b as any)?.dazeCount ?? 0);

    // 미입력 계산식(중앙 리스트에서만 표시용)
    const missCount = list === "middle" ? computeEffectiveMiss(b) : 0;

    const afterLabel =
      remain < 0
        ? (Math.abs(remain) <= OVERDUE_GRACE_MS ? "지남(유예)" : "지남")
        : (list === "middle" ? "뒤 예상" : "뒤 젠");

    return (
      <div
        key={b.id}
        className={`relative overflow-visible z-[40] hover:z-[90] rounded-xl shadow-sm p-3 text-sm ${blinkCls}`}
      >
        {/* 배지(미입력/멍) — 우측 상단 테두리 겹치기 (가로 4/5, 세로 1/3 지점) */}
        {((missCount > 0 && list === "middle") || dazeCount > 0) && (
          <div className="absolute top-0 right-0 translate-x-1/4 -translate-y-1/4 inline-flex flex-row flex-nowrap whitespace-nowrap items-center gap-2 pointer-events-none z-[95] scale-75">
            {/* 미입력 뱃지 */}
            {missCount > 0 && list === "middle" && (
              <span className="rounded-[8px] border border-sky-300 bg-sky-50/95 px-2 py-0.5 text-[11px] font-semibold text-sky-700 shadow-md">
                미입력 {missCount}
              </span>
            )}
            {/* 멍 뱃지 */}
            {dazeCount > 0 && (
              <span className="rounded-[6px] border border-amber-300 bg-amber-50/90 px-1.5 py-[1px] text-[10px] font-medium text-amber-700 shadow">
                멍 {dazeCount}
              </span>
            )}
          </div>
        )}

        {/* 보스명 */}
        <div className="font-medium text-[13px] whitespace-nowrap overflow-visible">{b.name}</div>

        {/* 타이머 */}
        <div className="text-xs text-slate-600 whitespace-nowrap">
          {hms == null ? "미입력" : (<>{hms}<span className="ml-1">{afterLabel}</span></>)}
        </div>

        {/* 버튼 영역 (세로크기 통일: text-[10px] leading-none px-2 py-[3px]) */}
        <div className="mt-1 grid grid-cols-[auto_1fr_auto] items-center gap-1 pr-1">
          <button
            type="button"
            onClick={() => instantCut(b)}
            className="text-[10px] leading-none px-2 py-[3px] rounded-md text-white bg-slate-900 hover:opacity-90"
          >
            컷
          </button>
          <div />
          {canDaze ? (
            <button
              type="button"
              onClick={() => addDaze(b)}
              className="text-[10px] leading-none px-2 py-[3px] rounded-md border text-slate-700 hover:bg-slate-50"
            >
              멍
            </button>
          ) : (
            <span className="text-[10px] leading-none px-2 py-[3px] rounded-md border opacity-0 select-none">멍</span>
          )}
          {/* 위치 버튼 */}
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
    const soon: BossDto[] = [];
    const rest: BossDto[] = [];

    for (const b of list) {
      const remain = remainingMsFor(b);
      const isSoon = remain > 0 && remain <= HIGHLIGHT_MS;
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
      const key = Number.isFinite(next) ? Math.max(next - now, 0) : Number.POSITIVE_INFINITY;
      return { b, key };
    });

    return withKey
      .filter(({ b }) => computeEffectiveMiss(b) === 0 && hasAnyRecord(b))
      .sort((a, z) => a.key - z.key)
      .map(({ b }) => b);
  }, [filteredAll, uiTick]);

  /** 중앙(미입력) — 지남 보스는 항상 최상단 + 깜빡임 유지 */
  const middleTracked = useMemo(() => {
    return filteredAll
      // 미입력 섹션에 들어갈 보스만 남김: 미입력 카운트>0 이거나, 기록 자체가 없는 보스
      .filter((b) => computeEffectiveMiss(b) > 0 || !hasAnyRecord(b))
      .map((b) => {
        const remain = remainingMsFor(b);
        // 정렬 키 산정
        // 1) 지남(유예 포함): 최우선 상단
        // 2) 남아있음: 남은 시간 오름차순
        // 3) 미입력(= remain === Infinity): 가장 아래쪽으로 보내기 위해 매우 큰 유한값
        const sortKey =
          remain < 0
            ? -999999
            : Number.isFinite(remain)
            ? remain
            : 9e15;
        return { b, sortKey };
      })
      .sort((a, z) => a.sortKey - z.sortKey)
      .map(({ b }) => b);
  }, [filteredAll, uiTick]);

  /** ───────── 우측: 고정 보스(05시 기준 사이클) ───────── */

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
      group: number;  // 0=지남<5m(빨강 상단 고정), 1=곧/대기(정상 정렬), 2=완료/지남>5m(하단, 파랑)
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
      await loadBosses();
    } catch (e: any) {
      alert(e?.message ?? "즉시 컷 실패");
    }
  }

  /** 좌/중: 멍(+1) — 서버 성공 후 목록 재로드 */
  async function addDaze(b: BossDto) {
    try {
      const timelineId = await getTimelineIdForBossName(b.name);
      if (!timelineId) {
        alert("해당 보스의 최근 컷 타임라인을 찾을 수 없습니다.");
        return;
      }
      await postJSON(`/v1/boss-timelines/${timelineId}/daze`, { atIso: new Date().toISOString() });
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
      <div className="min-h-0 overflow-x-visible overflow-y-hidden grid grid-cols-3 gap-4">
        {/* 좌측: 진행중(비고정) */}
        <section className="col-span-1 min-h-0 overflow-y-auto px-1 relative z-0">
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
                  <div className="grid grid-cols-3 gap-3 pt-3 isolate">
                    {merged.map((b) => renderTile(b, "left"))}
                  </div>
                );
              })()
            )}
          </div>
        </section>

        {/* 중앙: 미입력(비고정) */}
        <section className="col-span-1 min-h-0 overflow-y-auto px-1 relative z-0">
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
                  <div className="grid grid-cols-3 gap-3 pt-3">
                    {merged.map((b) => renderTile(b, "middle"))}
                  </div>
                );
              })()
            )}
          </div>
        </section>

        {/* 우측: 고정 보스(05시 리셋, 00:00 이후 전부 파랑) */}
        <section className="col-span-1 min-h-0 overflow-y-auto px-1 relative z-0">
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