import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { postJSON } from "@/lib/http";
import type { BossDto } from "../../types";

import BossCutManageModal from "@/components/modals/BossCutManageModal";
import CutModal from "@/screens/DashBoard/CutModal";

// ────────────────────────────────
// LocationHover: Tooltip with parent-managed hover state
// ────────────────────────────────
import { createPortal } from "react-dom";

const DEBUG_FIXED_SORT = false;

/** ───────── 상수 ───────── */
const MS = 1000;
const MIN = 60 * MS;
const DAY = 24 * 60 * MIN;

// 알림 시점(5분, 1분)
const ALERT_THRESHOLDS = [5 * MIN, 1 * MIN] as const;
// 임박(5분 이내) 하이라이트
const HIGHLIGHT_MS = 5 * MIN;
// 비고정: 지남 유예(파랑 유지) 5분
const OVERDUE_GRACE_MS = 10 * MIN;
// 비고정: 지남 3분째 경고 음성(한 번만)
const MISSED_WARN_MS = 3 * MIN;

/** 배지 오버레이 위치(카드 기준 비율) */
const BADGE_LEFT = "80%";      // 폭 4/5 지점
const BADGE_TOP  = "33.333%";  // 높이 1/3 지점//

// Combined에서 공유해서 사용
type Props = {
  refreshTick?: number;
  onForceRefresh?: () => void;
};

// 보스 타임라인 상세 최소 타입 (이 파일 전용)
type BossTimelineDetailLite = {
  ok: true;
  item: {
    bossMetaId: string | null;
    id: string;
    bossName: string;
    cutAt: string;
    createdBy: string;
    items: Array<{ id: string; itemName: string; isSold?: boolean; soldPrice?: number | null; looterLoginId?: string | null }>;
    distributions: Array<{ lootItemId: string | null; recipientLoginId: string; isPaid: boolean; amount?: number | null }>;
  };
};

//  ── 초성 검색 유틸 ──
const CHO = [
  "ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ",
  "ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ",
];
const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
const JUNG = 21;
const JONG = 28;



// 문자열 → 초성만 추출 (예: "서드 북드" → "ㅅㄷ ㅂㄷ")
function toChosung(str: string): string {
  let out = "";
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
      const idx = code - HANGUL_BASE;
      const choIdx = Math.floor(idx / (JUNG * JONG));
      out += CHO[choIdx] ?? ch;
    } else {
      // 영문/숫자/기타는 그대로 두거나 공백 유지
      out += ch;
    }
  }
  return out;
}

// 토큰이 '초성만'으로 구성됐는지 (ㄱ~ㅎ 범위)
function isChosungToken(token: string): boolean {
  if (!token) return false;
  for (const ch of token) {
    const c = ch.charCodeAt(0);
    // ㄱ(0x3131) ~ ㅎ(0x314E)
    if (c < 0x3131 || c > 0x314e) return false;
  }
  return true;
}

/** ───────── 타입 ───────── */
type FixedBossDto = {
  id: string;
  name: string;
  location: string;
  genTime: number | null;
  respawn: number;
  isRandom: boolean;
  lastCutAt: string | null;
  nextSpawnAt: string | null;
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
function fmtHMS(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  const t = Math.abs(ms);
  const totalSec = ms < 0 ? Math.floor(t / 1000) : Math.ceil(t / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
// genTime(분 단위) → HH:mm (KST 그대로 사용)
function fmtDaily(genTime: unknown) {
  const n = genTime == null ? NaN : Number(genTime);
  if (!Number.isFinite(n)) return "—";
  const m = Math.max(0, Math.min(1439, Math.floor(n)));
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** ───────── 컴포넌트 ───────── */
export default function LoggedInDashboard({
  refreshTick,
  onForceRefresh,
}: { refreshTick?: number; onForceRefresh?: () => void }) {
  /** 서버 데이터 */
  const [trackedRaw, setTrackedRaw] = useState<BossDto[]>([]);
  const [forgottenRaw, setForgottenRaw] = useState<BossDto[]>([]);
  const [fixedRaw, setFixedRaw] = useState<FixedBossDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);

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

  const [quickCutText, setQuickCutText] = useState("");
  const [quickSaving, setQuickSaving] = useState(false);
  const [uiTick, setUiTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setUiTick((x) => (x + 1) % 3600), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    loadBosses();
    const t = setInterval(loadBosses, 60_000); // 1분마다 자동 갱신
    return () => clearInterval(t);
  }, [refreshTick]);

  const lastNextSpawnRef = useRef<Map<string, number>>(new Map());
  const missedWarnSetRef = useRef<Set<string>>(new Set());
  const timelineIdCacheRef = useRef<Map<string, string>>(new Map());

  const fixedAlertedMapRef = useRef<Map<string, Set<number>>>(new Map());
  const fixedCycleStartRef = useRef<number>(0);

  // 고정 보스: 이번 발생까지 남은(ms) — (음수면 지남)
  function fixedRemainMs(f: FixedBossDto, nowMs = Date.now()) {
    const occ = fixedOccMs(f.genTime, nowMs);
    if (!Number.isFinite(occ)) return Number.POSITIVE_INFINITY;
    return occ - nowMs;
  }

  // 보스 시간 초기화 용
  const [initOpen, setInitOpen] = useState(false);
  const [initTime, setInitTime] = useState("07:30");
  const [initBusy, setInitBusy] = useState(false);

  // ──────────────── 컷/관리 팝업 상태 ────────────────
  const [cutModalState, setCutModalState] = useState<{ open: boolean; boss: BossDto | null; timelineId: string | null }>({
    open: false,
    boss: null,
    timelineId: null,
  });

  const [manageModalState, setManageModalState] = useState<{ open: boolean; timelineId: string | null }>({
    open: false,
    timelineId: null,
  });

  // 보스 검색 후 초기화 헬퍼
  const clearSearch = useCallback(() => {
    setQuery("");
    // 입력값 지우고 포커스까지 제거(모바일 키보드 닫힘 포함)
    const el = searchInputRef.current;
    if (el) {
      // value는 상태로 제어되지만 혹시 모를 브라우저 캐싱 대응
      el.value = "";
      el.blur();
    }
  }, []);

  // HH:mm → 오늘 날짜의 ms
  function parseTodayHHMM(hhmm: string): number | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    if (!m) return null;
    const hh = Number(m[1]), mm = Number(m[2]);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    return d.getTime();
  }

  function fmtTimeHM(dt: number | string | null | undefined): string {
    if (!dt) return "—";
    const d = new Date(dt);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  function nextFixedOccMs(genTime: number | null | undefined, nowMs = Date.now()): number | null {
    const occ = fixedOccMs(genTime, nowMs);
    if (!Number.isFinite(occ)) return null;
    return (occ as number) <= nowMs ? (occ as number) + DAY : (occ as number);
  }

  const [allBossOpen, setAllBossOpen] = useState(false);

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

      const prevMap = lastNextSpawnRef.current;
      const nextMap = new Map(prevMap);
      for (const b of (data.tracked ?? []) as BossDto[]) {
        const newMs = b.nextSpawnAt ? new Date(b.nextSpawnAt).getTime() : NaN;
        if (Number.isFinite(newMs)) nextMap.set(b.id, newMs as number);
      }
      lastNextSpawnRef.current = nextMap;

      if (DEBUG_FIXED_SORT) {
        // 백엔드에서 받은 원시 fixed 배열 상태
        const ids3637 = ((data.fixed ?? []) as any[]).filter((x) => x?.id === "37" || x?.id === "38" || x?.id === 37 || x?.id === 38);
        console.group("[fixedRaw from backend]");
        console.table((data.fixed ?? []).map((f: any) => ({
          id: String(f.id),
          name: f.name,
          genTime: f.genTime,
          lastCutAt: f.lastCutAt,
          nextSpawnAt: f.nextSpawnAt ?? null,
        })));
        console.log("=> 36/37 only:", ids3637);
        console.groupEnd();
      }
    } catch {
      setTrackedRaw([]);
      setForgottenRaw([]);
      setFixedRaw([]);
    } finally {
      setLoading(false);
    }
  }

  const hasAnyRecord = (b: BossDto) => {
    const serverDaze = (b as any)?.dazeCount ?? 0;
    return !!b.lastCutAt || serverDaze > 0;
  };

  /** 최근 컷 타임라인 id 조회(보스명) */
  type ListTimelinesLite = { ok: true; items: Array<{ id: string | number; bossName: string; cutAt: string }> };
  async function getTimelineIdForBossName(bossName: string): Promise<{ id: string | null; empty: boolean }> {
    const key = bossName?.trim();
    if (!key) return { id: null, empty: true };

    try {
      const resp = await postJSON<{ ok: true; id: string | null; empty: boolean }>(
        "/v1/dashboard/boss-timelines/latest-id",
        { bossName: key, preferEmpty: true }
      );
      const id = resp?.id ?? null;
      const empty = !!resp?.empty;
      return { id, empty };
    } catch {
      return { id: null, empty: true };
    }
  }

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

  const trackedIdSetRef = useRef<Set<string>>(new Set());
  const forgottenNextMapRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    trackedIdSetRef.current = new Set(trackedIdSet);
    forgottenNextMapRef.current = new Map(forgottenNextMap);
  }, [trackedIdSet, forgottenNextMap]);

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

  const filteredAll = useMemo(() => {
    const q = query.trim();
    if (!q) return allBossesSortedByNext;
    const tokens = q.split(/\s/g).filter(Boolean);

    const match = (b: BossDto) => {
      const hay = `${b.name} ${b.location ?? ""}`;
      const hayLower = hay.toLowerCase();
      // 초성 캐시 (보스마다 한 번만 계산)
      const hayCho = toChosung(hay);

      return tokens.every((t) => {
        const tLower = t.toLowerCase();
        // 일반 검색: 부분 문자열
        if (hayLower.includes(tLower)) return true;
        // 초성 검색: 토큰이 초성으로만 이루어졌다면, 초성 문자열에서 부분 일치
        if (isChosungToken(t)) return hayCho.includes(t);
        return false;
      });
    };

    return allBossesSortedByNext.filter(match);
  }, [query, allBossesSortedByNext]);

  /** ───────── 수정된 미입력 계산식 ───────── */
  function computeEffectiveMiss(b: BossDto, now = Date.now()): number {
    if (!b.isRandom) return 0;

    const respawnMin = Number(b.respawn ?? 0);
    if (respawnMin <= 0) return 0;

    const respawnMs = respawnMin * 60 * 1000;

    if (!b.lastCutAt) {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      const sinceMidnight = d.getTime();
      const elapsedMin = (now - sinceMidnight) / 60000;
      return Math.max(0, Math.floor(elapsedMin / respawnMin));
    }

    const lastMs = new Date(b.lastCutAt).getTime();
    if (!Number.isFinite(lastMs) || now <= lastMs) return 0;

    const diff = now - lastMs;
    if (diff < respawnMs + OVERDUE_GRACE_MS) {
      return 0;
    }

    const overdueStart = lastMs + respawnMs + OVERDUE_GRACE_MS;
    const missed = 1 + Math.floor((now - overdueStart) / respawnMs);
    return missed;
  }

  const remainingMsFor = (b: BossDto) => {
    const now = Date.now();
    const nextMs = getNextMsGeneric(b);
    if (!Number.isFinite(nextMs)) return Number.POSITIVE_INFINITY;
    const diff = nextMs - now;
    if (diff <= 0 && diff >= -OVERDUE_GRACE_MS) {
      return diff;
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

// 모든 (비고정) 보스를 오늘 입력시각 + 5분으로 컷
// 그리고 "이력 전무( lastCutAt=null && dazeCount==0 )"였던 보스는 즉시 1회 멍 처리
async function runInitCutForAll() {
  if (initBusy) return;
  const baseMs = parseTodayHHMM(initTime);
  if (!baseMs) { alert("시간 형식은 HH:mm 입니다. 예) 07:30"); return; }

  const cutAtIso = new Date(baseMs + 5 * 60 * 1000).toString(); // +5분
  const normals: BossDto[] = [...trackedRaw, ...forgottenRaw];
  // id 중복 제거
  const seen = new Set<string>();
  const bosses = normals.filter(b => (seen.has(b.id) ? false : (seen.add(b.id), true)));

  if (bosses.length === 0) { alert("초기화할 보스가 없습니다."); return; }

  if (!confirm(`모든 보스를 오늘 ${initTime} + 5분(${new Date(cutAtIso).toLocaleString()})으로 컷 처리합니다.\n'이력 전무' 보스는 1회 멍까지 자동 처리합니다.`)) return;

  setInitBusy(true);
  try {
    // 1) 일괄 컷
    for (const b of bosses) {
      try {
        await postJSON(`/v1/dashboard/bosses/${b.id}/cut`, {
          cutAtIso,
          mode: "TREASURY",
          items: [],
          participants: [],
        });
      } catch (e) {
        console.warn("[init-cut] failed:", b.name, e);
      }
    }

    // 2) '이력 전무' 보스만 1회 멍 (lastCutAt == null && dazeCount == 0 이었던 대상)
    for (const b of bosses) {
      const wasNoHistory = !b.lastCutAt && Number((b as any)?.dazeCount ?? 0) === 0;
      if (!wasNoHistory) continue;
      try {
        const timelineId = await getTimelineIdForBossName(b.name);
        if (timelineId) {
          await postJSON(`/v1/boss-timelines/${timelineId}/daze`, { atIso: new Date().toString() });
        }
      } catch (e) {
        console.warn("[init-daze] failed:", b.name, e);
      }
    }

    alert("보스 시간 초기화 완료!");
    await loadBosses();
    clearSearch();
    setInitOpen(false);
  } finally {
    setInitBusy(false);
  }
}

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
  function LocationHover({
    text,
    bossId,
    hoverBossId,
    setHoverBossId,
  }: {
    text?: string | null;
    bossId: string;
    hoverBossId: string | null;
    setHoverBossId: (id: string | null) => void;
  }) {
    const open = hoverBossId === bossId;
    const btnRef = useRef<HTMLButtonElement | null>(null);
    const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
    // When mouse enters button or tooltip, set hovered bossId; when leaves, clear
    const handleButtonMouseEnter = useCallback(() => setHoverBossId(bossId), [setHoverBossId, bossId]);
    const handleButtonMouseLeave = useCallback(() => setHoverBossId(null), [setHoverBossId]);
    const handleTooltipMouseEnter = useCallback(() => setHoverBossId(bossId), [setHoverBossId, bossId]);
    const handleTooltipMouseLeave = useCallback(() => setHoverBossId(null), [setHoverBossId]);

    // Calculate tooltip position when open
    useEffect(() => {
      if (!open) {
        setTooltipPos(null);
        return;
      }
      function updatePosition() {
        const btn = btnRef.current;
        if (btn) {
          const rect = btn.getBoundingClientRect();
          // Position below the button, aligned left
          setTooltipPos({
            top: rect.bottom + window.scrollY + 4,
            left: rect.left + window.scrollX,
          });
        }
      }
      updatePosition();
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("resize", updatePosition);
      return () => {
        window.removeEventListener("scroll", updatePosition, true);
        window.removeEventListener("resize", updatePosition);
      };
    }, [open]);

    // Only one tooltip open at a time: controlled by hoverBossId/setHoverBossId
    // Tooltip stays open when hovering over it (no flicker)

    // Render tooltip using portal
    const tooltipNode =
      open && !!text && tooltipPos
        ? createPortal(
            <div
              className="z-[999999] w-[200px] rounded-md border bg-white/95 px-2 py-1 text-[12px] text-slate-700 shadow-lg backdrop-blur-sm whitespace-pre-wrap break-keep"
              style={{
                position: "absolute",
                top: tooltipPos.top,
                left: tooltipPos.left,
              }}
              onMouseEnter={handleTooltipMouseEnter}
              onMouseLeave={handleTooltipMouseLeave}
            >
              {text}
            </div>,
            document.body
          )
        : null;

    return (
      <>
        <div className="relative block w-full">
          <button
            type="button"
            ref={btnRef}
            onMouseEnter={handleButtonMouseEnter}
            onMouseLeave={handleButtonMouseLeave}
            className="pointer-events-auto w-full text-center rounded-md border text-[10px] leading-none px-2 py-[3px]
                      bg-white/80 text-slate-600 shadow-sm hover:bg-white relative z-[70]"
          >
            보스 젠 위치
          </button>
        </div>
        {tooltipNode}
      </>
    );
  }

  // State for tracking which boss's tooltip is open
  const [hoverBossId, setHoverBossId] = useState<string | null>(null);

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
        {((missCount > 0 && list === "middle") || (dazeCount > 0 && list !== "middle")) && (
          <div className="absolute top-0 right-0 translate-x-1/4 -translate-y-1/4 inline-flex flex-row flex-nowrap whitespace-nowrap items-center gap-2 pointer-events-none z-[95] scale-75">
            {/* 중앙 리스트: 미입력 뱃지만 표시 */}
            {missCount > 0 && list === "middle" && (
              <span className="rounded-[8px] border border-sky-300 bg-sky-50/95 px-2 py-0.5 text-[11px] font-semibold text-sky-700 shadow-md">
                미입력 {missCount}
              </span>
            )}
            {/* 좌측/우측 리스트에서만 멍 뱃지 표시 */}
            {dazeCount > 0 && list !== "middle" && (
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

        {/* 버튼 영역 */}
        <div className="mt-1 grid grid-cols-2 gap-1 items-center">
          {list === "left" && b.isRandom ? (
            <>
              <button
                type="button"
                onClick={() => instantCut(b)}
                className="w-full text-[10px] leading-none px-2 py-[3px] rounded-md text-white bg-slate-900 hover:opacity-90"
              >
                컷
              </button>
              <button
                type="button"
                onClick={() => addDaze(b)}
                className="w-full text-[10px] leading-none px-2 py-[3px] rounded-md border text-slate-700 hover:bg-slate-50"
              >
                멍
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => instantCut(b)}
              className="col-span-2 w-full text-[10px] leading-none px-2 py-[3px] rounded-md text-white bg-slate-900 hover:opacity-90"
            >
              컷
            </button>
          )}

          {b.location && (
            <div className="col-span-2 pt-1 w-full">
              <div className="w-full">
                <LocationHover
                  text={b.location}
                  bossId={b.id}
                  hoverBossId={hoverBossId}
                  setHoverBossId={setHoverBossId}
                />
              </div>
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
      f: FixedBossDto & { nextSpawnAt?: string | null };
      group: number;
      key: number;
      reasons: Record<string, any>;
    };

    const rows: Row[] = fixedRaw.map((f) => {
      const remain = fixedRemainMs(f, now);
      const overdueKeep = remain < 0 && remain >= -OVERDUE_GRACE_MS;
      const soon = remain > 0 && remain <= HIGHLIGHT_MS;
      const caught = fixedIsCaughtCycle(f, now);
      const postLast = isPostLastWindow(now);
      const afterGrace = remain <= -OVERDUE_GRACE_MS;

      const isBlue = caught || postLast || afterGrace;

      let group = 1;
      if (overdueKeep) group = 0;
      else if (isBlue) group = 2;

      let key: number;

      // 🔹 기감 1층(37) / 2층(38) → nextSpawnAt 기준
      if (f.id === "37" || f.id === "38") {
        if (f.nextSpawnAt) {
          const ns = new Date(f.nextSpawnAt).getTime();
          const diff = ns - now;
          key = Number.isFinite(diff) ? diff : Number.POSITIVE_INFINITY;
        } else {
          key = Number.POSITIVE_INFINITY;
        }
        group = 1; // 항상 대기 그룹
      } else {
        if (group === 0) key = Math.abs(remain);
        else if (group === 1) key = Number.isFinite(remain) ? remain : Number.POSITIVE_INFINITY;
        else key = fixedOccMs(f.genTime, now);
      }

      const reasons = {
        id: String(f.id),
        name: (f as any).name,
        nextSpawnAt: (f as any).nextSpawnAt ?? null,
        remain,
        overdueKeep,
        soon,
        caught,
        postLast,
        afterGrace,
        isBlue,
        group,
        key,
      };

      return { f: f as any, group, key, reasons };
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

      let n: number | null = null;

      // 🔹 기감 1/2층은 nextSpawnAt 사용
      if (f.id === "37" || f.id === "38") {
        n = f.nextSpawnAt ? new Date(f.nextSpawnAt).getTime() : null;
      } else {
        n = fixedOccMs(f.genTime, now);
      }

      if (n != null && n < bestMs) {
        bestMs = n;
        bestId = f.id;
      }
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
    const iso = d.toString();

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
      await loadBosses();      // 상단 섹션 갱신
      clearSearch();           // ✅ 검색어/결과 초기화
      onForceRefresh?.();      // 하단 섹션 강제 갱신
    } catch (e: any) {
      alert(e?.message ?? "간편컷 저장 실패");
    } finally {
      setQuickSaving(false);
    }
  }

  // 컷 처리
  async function instantCut(b: BossDto) {
    try {
      await postJSON(`/v1/dashboard/bosses/${b.id}/cut`, {
        cutAtIso: new Date().toString(),
        mode: "TREASURY",
        items: [],
        participants: [],
      });
      await loadBosses();
      clearSearch();        // ✅ 컷 후 검색어/결과 초기화
      onForceRefresh?.();   // ✅ 하단 새로고침
    } catch (e: any) {
      alert(e?.message ?? "즉시 컷 실패");
    }
  }

  // 멍 처리
  async function addDaze(b: BossDto) {
    try {
      const timelineId = await getTimelineIdForBossName(b.name);
      if (!timelineId) {
        alert("해당 보스의 최근 컷 타임라인을 찾을 수 없습니다.");
        return;
      }
      await postJSON(`/v1/boss-timelines/${timelineId}/daze`, { atIso: new Date().toString() });
      await loadBosses();
      clearSearch();
      onForceRefresh?.();   // ✅ 하단 새로고침
    } catch {
      alert("멍 기록에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  const [shareOpen, setShareOpen] = useState(false);
  const [shareText, setShareText] = useState("");

  function openShareModal() {
    const lines: string[] = [];
    const now = Date.now();

    // 비고정(랜덤) 보스: getNextMsGeneric(b) 기반
    const normals: BossDto[] = [...trackedRaw, ...forgottenRaw];
    const seen = new Set<string>();
    const bosses = normals.filter(b => (seen.has(b.id) ? false : (seen.add(b.id), true)));

    for (const b of bosses) {
      const nextMs = getNextMsGeneric(b);                // ▶️ 다음 젠 시각
      const nextStr = fmtTimeHM(Number.isFinite(nextMs) ? nextMs : null);
      const miss = computeEffectiveMiss(b);              // 미입력 회수
      lines.push(`${nextStr} ${b.name} (미입력${miss}회)`);
    }

    setShareText(lines.join("\n"));
    setShareOpen(true);
  }

  // 디코 보스봇 정보 가져오기
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");

  /** JSX */
  return (
    <div className="h-full min-h-0 overflow-hidden grid grid-rows-[auto_1fr] gap-3">
      {/* 상단바 */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* 검색(좌/중만) */}
          <div className="relative w-auto min-w-[140px] max-w-[180px]">
            <input
              ref={searchInputRef}
              className="w-full border rounded-xl px-2 py-1.5 pr-6 text-sm"
              placeholder="보스 이름/위치 검색"
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

        {/* 칸막이 */}
        <div className="h-6 border-l mx-2"></div>

        {/* 음성 알림 */}
        <label className="flex items-center gap-2 text-sm select-none">
          <input
            type="checkbox"
            checked={voiceEnabled}
            onChange={(e) => setVoiceEnabled(e.currentTarget.checked)}
          />
          음성 알림
        </label>

        {/* 칸막이 */}
        <div className="h-6 border-l mx-2"></div>

        {/* 간편 컷 */}
        <div className="flex items-center gap-2">
          <input
            className="border rounded-xl px-4 py-2 w-[220px]"
            placeholder="예: 2200 서드"
            value={quickCutText}
            onChange={(e) => setQuickCutText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); submitQuickCut(); }
            }}
          />
        </div>

        {/* 칸막이 */}
        <div className="h-6 border-l mx-2"></div>

        {/* 신규 버튼들 */}
        <div className="flex items-center gap-2">
          {/* 보스 초기화 */}
          <button
            type="button"
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-900 text-white text-sm hover:opacity-90"
            onClick={() => setInitOpen(v => !v)}
            title="모든 보스를 지정 시각(+5분)으로 일괄 컷"
          >
            {/* 🔄 새로고침 아이콘 */}
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v6h6M20 20v-6h-6M20 4h-6V2m0 0a8 8 0 010 16m0-16a8 8 0 100 16" />
            </svg>
            보스 초기화
          </button>

          {/* 디코 보스봇 시간 공유 */}
          <button
            type="button"
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-900 text-white text-sm hover:opacity-90"
            onClick={openShareModal}
          >
            {/* 📤 공유 아이콘 */}
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 12v.01M4 6v.01M4 18v.01M12 6v12m0 0l-4-4m4 4l4-4" />
            </svg>
            디코 보스봇 시간 공유
          </button>

          {/* 디코 보스봇 시간 가져오기 */}
          <button
            type="button"
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-900 text-white text-sm hover:opacity-90"
            onClick={() => setImportOpen(true)}
          >
            {/* 📥 가져오기 아이콘 (공유 반대 방향) */}
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M20 12v.01M20 6v.01M20 18v.01M12 18V6m0 0l-4 4m4-4l4 4" />
            </svg>
            디코 보스봇 시간 가져오기
          </button>
        </div>
      </div>

      {/* 본문 3컬럼 */}
      <div className="min-h-0 grid grid-cols-3 gap-4">
        {/* 좌측: 진행중(비고정) */}
        <section className="col-span-1 min-h-0 relative z-0">
          <div className="h-full overflow-y-auto pr-4 -mr-4">
            <h2 className="text-base font-semibold mb-2 text-slate-700">
              다음 보스 젠
              {query ? <span className="ml-2 text-xs text-slate-400">({leftTracked.length}개)</span> : null}
            </h2>

            <div className="flex-1 min-h-0">
              {loading ? (
                <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-500">
                  불러오는 중…
                </div>
              ) : leftTracked.length === 0 ? (
                <div className="mt-3 h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-400 italic">
                  {query ? "검색 결과가 없습니다." : "스케줄 추적 중인 보스가 없습니다."}
                </div>
              ) : (
                (() => {
                  const { soon, rest } = splitSoonWithin5m(leftTracked);
                  const merged = [...soon, ...rest];
                  const topSix = merged.slice(0, 6);

                  return (
                    <>
                      <div className="grid grid-cols-3 gap-3 pt-3 isolate">
                        {topSix.map((b) => renderTile(b, "left"))}
                      </div>

                      <div className="mt-4 text-xs text-slate-500 text-center space-y-1">
                        <p>젠 시간 빠른 순 상위 6개 보스입니다.</p>
                      </div>

                      {/* 전체 보기 버튼 */}
                      <div className="mt-3 flex justify-center">
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50 text-sm"
                          onClick={() => setAllBossOpen(true)}
                        >
                          전체 보스 목록 보기
                        </button>
                      </div>
                    </>
                  );
                })()
              )}
            </div>
          </div>
        </section>

        {/* 중앙: 미입력(비고정) */}
        <section className="col-span-1 h-full min-h-0 relative z-0 flex flex-col">
          <div className="h-full overflow-y-auto pr-4 -mr-4">
            <h2 className="text-base font-semibold mb-2 text-slate-700">잃어버린 보스</h2>

            <div className="flex-1 min-h-0">
              {loading ? (
                <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-500">
                  불러오는 중…
                </div>
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
          </div>
        </section>

        {/* 우측: 고정 보스 */}
        <section className="col-span-1 h-full min-h-0 relative z-0 flex flex-col">
          <div className="h-full overflow-y-auto pr-4 -mr-4">
            <h2 className="text-base font-semibold mb-2 text-slate-700">고정 보스</h2>

            <div className="flex-1 min-h-0 space-y-3">
              {loading ? (
                <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-500">
                  불러오는 중…
                </div>
              ) : fixedSorted.length === 0 ? (
                <div className="mt-3 h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-400 italic">
                  고정 보스가 없습니다.
                </div>
              ) : (
                fixedSorted.map((fb) => {
                  const now = Date.now();
                  const remain = fixedRemainMs(fb, now);
                  const overdueKeep = remain < 0 && remain >= -OVERDUE_GRACE_MS;
                  const soon = remain > 0 && remain <= HIGHLIGHT_MS;
                  const afterGrace = remain <= -OVERDUE_GRACE_MS;
                  const isCaught = fixedIsCaughtCycle(fb, now);
                  const postLast = isPostLastWindow(now);

                  const isBlue = isCaught || postLast || afterGrace;
                  const isRed = soon || overdueKeep;
                  const wrapClass = isRed
                    ? "relative rounded-xl border shadow-sm p-3 text-sm ring-2 ring-rose-400 bg-rose-50/60 animate-blink"
                    : isBlue
                    ? "relative rounded-xl border shadow-sm p-3 text-sm ring-2 ring-sky-300 bg-sky-50/60"
                    : "relative rounded-xl border shadow-sm p-3 text-sm bg-white";

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
                        젠 시각:{" "}
                        <span className="font-semibold">
                          {(() => {
                            const ns = (fb as any).nextSpawnAt as string | null | undefined;
                            if (ns) {
                              // HH:mm 형태로 표기 (서버가 ISO 내려주므로 시각 포맷으로)
                              const t = new Date(ns).getTime();
                              return fmtTimeHM(Number.isFinite(t) ? t : null) ?? "—";
                            }
                            // nextSpawnAt이 없으면 기존 genTime 사용 (고정보스 일반 케이스)
                            if (fb.genTime != null) return fmtDaily(fb.genTime);
                            return "—";
                          })()}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>
      </div>

      {/* ───────────────── 보스 시간 초기화 모달 ───────────────── */}
      {initOpen && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center"
          aria-modal="true"
          role="dialog"
          onKeyDown={(e) => {
            if (e.key === "Escape") setInitOpen(false);
          }}
        >
          {/* backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setInitOpen(false)}
          />

          {/* modal card */}
          <div className="relative z-[1001] w-[90vw] max-w-[420px] rounded-2xl bg-white shadow-xl border p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-semibold">보스 시간 초기화</h3>
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-slate-100"
                onClick={() => setInitOpen(false)}
                aria-label="닫기"
              >
                ×
              </button>
            </div>

            <p className="text-[12px] text-slate-600 mb-3">
              입력한 시간의 <b>+ 5분</b>으로 오늘 날짜에 모든 보스를 컷합니다.
              <br />
              기존에 <b>컷/멍 이력이 없던 보스</b>는 이번 1회에 한해 자동으로 멍 처리합니다.
            </p>

            <div className="flex items-center gap-2">
              <input
                className="border rounded-xl px-3 py-2 w-[130px] text-center"
                placeholder="07:30"
                value={initTime}
                onChange={(e) => setInitTime(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); runInitCutForAll(); }
                }}
              />
              <button
                type="button"
                className="px-3 py-2 rounded-xl bg-slate-900 text-white hover:opacity-90 disabled:opacity-60"
                onClick={runInitCutForAll}
                disabled={initBusy}
              >
                {initBusy ? "처리 중…" : "시간 초기화"}
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-xl border hover:bg-slate-100"
                onClick={() => setInitOpen(false)}
              >
                취소
              </button>
            </div>

            <div className="mt-3 text-[11px] text-slate-500">
              예) 07:30 을 입력하면 오늘 07:35 로 일괄 컷
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl p-4 w-[600px] max-w-[90vw]">
            <h3 className="text-lg font-semibold mb-2">디코 보스탐 정보 가져오기</h3>
            <textarea
              className="w-full border rounded p-2 text-sm font-mono h-64"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={`예)\n14:32 녹샤 (미입력0회)\n14:32 서드 (미입력0회)\n...`}
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                className="px-3 py-2 rounded-xl border hover:bg-slate-100"
                onClick={() => setImportOpen(false)}
              >
                취소
              </button>
              <button
                className="px-3 py-2 rounded-xl bg-slate-900 text-white hover:opacity-90"
                onClick={async () => {
                  try {
                    await postJSON("/v1/dashboard/import-discord", { text: importText });
                    alert("보스탐 데이터가 반영되었습니다.");
                    setImportOpen(false);
                    await loadBosses(); // 상단 새로고침
                    onForceRefresh?.(); // 하단도 새로고침
                  } catch (e: any) {
                    alert(e?.message ?? "업로드 실패");
                  }
                }}
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {shareOpen && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center"
          aria-modal="true"
          role="dialog"
        >
          {/* 배경 */}
          <div className="absolute inset-0 bg-black/50" onClick={() => setShareOpen(false)} />

          {/* 모달 카드 */}
          <div className="relative z-[1001] w-[90vw] max-w-[520px] rounded-2xl bg-white shadow-xl border p-4 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-semibold">디코 보스탐 공유</h3>
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-slate-100"
                onClick={() => setShareOpen(false)}
              >
                ×
              </button>
            </div>

            <textarea
              className="flex-1 w-full border rounded p-2 text-sm font-mono resize-none"
              rows={15}
              readOnly
              value={shareText}
            />

            <div className="flex justify-end gap-2 mt-3">
              <button
                type="button"
                className="px-3 py-2 rounded-xl bg-slate-900 text-white hover:opacity-90"
                onClick={() => {
                  navigator.clipboard.writeText(shareText).then(() => {
                    alert("복사 완료!");
                  });
                }}
              >
                복사
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-xl border hover:bg-slate-100"
                onClick={() => setShareOpen(false)}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {allBossOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl p-4 w-[90vw] max-w-3xl h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-semibold">전체 보스 젠 목록</h3>
              <button
                type="button"
                className="px-2 py-1 rounded hover:bg-slate-100"
                onClick={() => setAllBossOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-2 px-3 text-left font-semibold">보스명</th>
                    <th className="py-2 px-3 text-left font-semibold">젠 시각</th>
                    <th className="py-2 px-3 text-left font-semibold">남은 시간</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAll.map((b) => (
                    <tr key={b.id} className="border-b last:border-b-0 hover:bg-slate-50">
                      <td className="py-2 px-3 whitespace-nowrap">{b.name}</td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        {(() => {
                          const nextMs = getNextMsGeneric(b);
                          return fmtTimeHM(Number.isFinite(nextMs) ? nextMs : null);
                        })()}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        {(() => {
                          const ms = remainingMsFor(b);
                          const hms = fmtHMS(ms);
                          return hms != null ? hms : "미입력";
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {manageModalState.open && (
        <BossCutManageModal
          open={manageModalState.open}
          timelineId={manageModalState.timelineId}
          onClose={() => setManageModalState({ open: false, timelineId: null })}
          onSaved={() => {
            loadBosses();
            setManageModalState({ open: false, timelineId: null });
          }}
        />
      )}

      {cutModalState.open && (
        <CutModal
          open={cutModalState.open}
          boss={cutModalState.boss}
          timelineId={cutModalState.timelineId}
          defaultCutAt={new Date().toString()}
          onClose={() => setCutModalState({ open: false, boss: null, timelineId: null })}
          onSaved={() => {
            loadBosses();
            setCutModalState({ open: false, boss: null, timelineId: null });
          }}
        />
      )}
    </div>
  );
}