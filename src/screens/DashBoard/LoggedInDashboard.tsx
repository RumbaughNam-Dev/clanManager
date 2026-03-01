import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { postJSON, putJSON } from "@/lib/http";
import type { BossDto } from "../../types";
import { useAuth } from "@/contexts/AuthContext";

import BossCutManageModal from "@/components/modals/BossCutManageModal";
import Modal from "@/components/common/Modal";
import CutModal from "@/screens/DashBoard/CutModal";
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
const WARN_10_MS = 10 * MIN;
const WARN_15_MS = 15 * MIN;
// 비고정: 지남 유예(파랑 유지) 5분
const OVERDUE_GRACE_MS = 10 * MIN;

// ⬇️ 추가: 컷/멍 직후 깜빡임 & 상단고정 억제 시간(요구: 10분)
const ACTION_SILENCE_MS = OVERDUE_GRACE_MS;

// 비고정: 지남 3분째 경고 음성(한 번만)
const MISSED_WARN_MS = 3 * MIN;

/** 배지 오버레이 위치(카드 기준 비율) — 요구 반영: 우상단 테두리 겹치기 */
const BADGE_LEFT = "80%";
const BADGE_TOP  = "33.333%";
const BOT_COMMAND_HELP = [
  "-v 메세지 : 메세지를 음성으로 읽어줍니다.",
  "보탐 초기화 : 현재 시각으로 보스타임을 초기화합니다.",
  "[보스명] 컷 : 입력한 보스를 현재 시각으로 컷 처리합니다.",
  "컷 / ㅋ / z : 현재 목록 최상단 보스를 컷 처리합니다.",
  "[보스명] 멍 : 입력한 보스를 현재 시각으로 멍 처리합니다.",
  "멍 / ㅁ / a : 현재 목록 최상단 보스를 멍 처리합니다.",
].join("\n");

const OVERDUE_STATE_KEY = "overdueStateMap";

// ── 초성 검색 유틸 ──
const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
const JUNG = 21;
const JONG = 28;

function toChosung(str: string): string {
  let out = "";
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
      const idx = code - HANGUL_BASE;
      const choIdx = Math.floor(idx / (JUNG * JONG));
      out += CHO[choIdx] ?? ch;
    } else {
      out += ch;
    }
  }
  return out;
}
function isChosungToken(token: string): boolean {
  if (!token) return false;
  for (const ch of token) {
    const c = ch.charCodeAt(0);
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

type RecentTimelineRow = {
  id: string;
  bossName: string;
  cutAt: string;
  createdBy?: string | null;

  // ▼ 상태 계산용(백엔드 /v1/boss-timelines가 내려주는 그대로 수용)
  items?: Array<{
    id: string;
    itemName: string;
    isSold: boolean;
    toTreasury?: boolean;   // 구스키마
    isTreasury?: boolean;   // 신스키마
  }>;
  distributions?: Array<{
    lootItemId: string | null;
    recipientLoginId: string;
    isPaid: boolean;
  }>;
};

type ListTimelinesLite = { ok: true; items: Array<{ id: string | number; bossName: string; cutAt: string }> };

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
function fmtElapsedLabel(ms: number): string {
  const t = Math.max(0, Math.floor(Math.abs(ms) / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  if (h > 0) return `${h}시간 ${m}분 ${s}초 지남`;
  return `${m}분 ${s}초 지남`;
}
function fmtDaily(genTime: unknown) {
  const n = genTime == null ? NaN : Number(genTime);
  if (!Number.isFinite(n)) return "—";
  const m = Math.max(0, Math.min(1439, Math.floor(n)));
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
function fmtTimeHM(dt: number | string | null | undefined): string {
  if (!dt) return "—";
  const d = new Date(dt);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

// ── 잡은보스 이력 상태 계산 ──
function isAllTreasury(items: any[] = []) {
  if (items.length === 0) return false;
  return items.every(it => (it.toTreasury ?? it.isTreasury) === true);
}
function isAllSold(items: any[] = []) {
  return items.length > 0 && items.every(it => it.isSold === true);
}
function isAnySold(items: any[] = []) {
  return items.some(it => it.isSold === true);
}
function isAllPaid(items: any[] = [], distributions: any[] = []) {
  if (items.length === 0) return false;
  // 분배는 아이템별 모두 존재 + 모두 isPaid=true 여야 완료
  const byItem = new Map<string, any[]>();
  (distributions ?? []).forEach((d) => {
    if (!d.lootItemId) return;
    const arr = byItem.get(d.lootItemId) ?? [];
    arr.push(d);
    byItem.set(d.lootItemId, arr);
  });
  const soldItems = items.filter(it => it.isSold === true);
  if (soldItems.length === 0) return false;
  return soldItems.every(it => {
    const ds = byItem.get(it.id) ?? [];
    if (ds.length === 0) return false;
    return ds.every(x => x.isPaid === true);
  });
}

/** 버튼 라벨/색상/우선순위 계산 */
function calcAction(row: RecentTimelineRow): {
  label: "정보입력" | "템 판매정보 입력" | "분배정보 입력" | "분배완료";
  tone: "default" | "warning" | "success";
  pin: boolean; // 판매중/분배미완 → 상단 고정
} {
  const items = row.items ?? [];
  const dists = row.distributions ?? [];

  const hasAnyData =
    (items.length > 0) || (dists.length > 0);

  if (!hasAnyData) {
    return { label: "정보입력", tone: "default", pin: false };
  }

  const treasuryAll = isAllTreasury(items);
  const allSold = isAllSold(items);
  const anySold = isAnySold(items);

  if (!allSold) {
    // 하나라도 판매 안됐으면 → 판매중
    return { label: "템 판매정보 입력", tone: "warning", pin: true };
  }

  // 전부 판매 완료
  if (treasuryAll) {
    // 혈비귀속이면 분배 없이도 완료 처리
    return { label: "분배완료", tone: "success", pin: false };
  }

  // 일반 분배: 모두 지급완료여야 완료
  const allPaid = isAllPaid(items, dists);
  if (!allPaid) {
    return { label: "분배정보 입력", tone: "warning", pin: true };
  }

  return { label: "분배완료", tone: "success", pin: false };
}

// 로컬 yyyy-MM-dd 포맷
function formatDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
// 최근 N일(from~to) 기본 범위 만들기 (기본 90일)
function getDateRangeLastNDays(n = 90) {
  const today = new Date();
  const from = new Date(today.getTime() - n * 24 * 60 * 60 * 1000);
  return { fromDate: formatDateLocal(from), toDate: formatDateLocal(today) };
}

// 두 날짜(YYYY-MM-DD)의 '일수 차이(포함형)' — from~to가 365일 이하면 OK
function daysBetweenInclusive(a: string, b: string): number {
  if (!a || !b) return Infinity;
  const aDt = new Date(a + "T00:00:00");
  const bDt = new Date(b + "T00:00:00");
  // a <= b 가정. 뒤집혀 있으면 교환
  const s = Math.min(aDt.getTime(), bDt.getTime());
  const e = Math.max(aDt.getTime(), bDt.getTime());
  // 포함형이므로 +1
  return Math.floor((e - s) / (24 * 60 * 60 * 1000)) + 1;
}

// YYYY-MM-DD에 n일 더한 문자열 반환 (로컬 기준)
function addDaysStr(base: string, n: number): string {
  if (!base) return "";
  const [y, m, d] = base.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return formatDateLocal(dt);
}

// KST(Asia/Seoul) 기준 하루의 시작/끝 (Date → ms)
function kstDayRangeMs(yyyyMmDd: string): { start: number; end: number } {
  // yyyy-MM-dd → KST 자정~자정-1ms
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  // KST 오프셋(+09:00) 고려해서 로컬 시각 대신 UTC로 보정
  const start = Date.UTC(y, (m - 1), d, 0, 0, 0) - (9 * 60 * 60 * 1000) + (9 * 60 * 60 * 1000);
  // 위 한 줄은 가독성 위해 남겼지만, 결국 start는 해당 날짜의 00:00:00 KST
  const end = start + (24 * 60 * 60 * 1000) - 1; // 23:59:59.999
  return { start, end };
}

// KST(Asia/Seoul) 기준 from~to 전체 구간
function kstRangeMs(fromDate: string, toDate: string): { start: number; end: number } {
  const s = kstDayRangeMs(fromDate).start;
  const e = kstDayRangeMs(toDate).end;
  return { start: s, end: e };
}

// 한국어 로케일("YYYY. M. D. 오전/오후 h:mm:ss")까지 파싱하는 느슨한 파서
function toMsLoose(dt?: string | null): number {
  if (!dt) return NaN;

  // 1) 표준/일반 문자열 먼저 시도
  const n = new Date(dt).getTime();
  if (Number.isFinite(n)) return n;

  // 2) 한국어 로케일: 2025. 10. 21. 오전 7:35:00
  const m = /^\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(오전|오후)\s*(\d{1,2}):(\d{2}):(\d{2})\s*$/.exec(dt);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const d = parseInt(m[3], 10);
    const ap = m[4]; // 오전/오후
    let H = parseInt(m[5], 10);
    const MM = parseInt(m[6], 10);
    const SS = parseInt(m[7], 10);
    if (ap === "오후" && H !== 12) H += 12;
    if (ap === "오전" && H === 12) H = 0;

    // 로컬 타임존 기준으로 생성 (KST 환경에서 기대값과 일치)
    const msLocal = new Date(y, mo, d, H, MM, SS).getTime();
    if (Number.isFinite(msLocal)) return msLocal;
  }

  return NaN;
}

/** ───────── 컴포넌트 ───────── */
export default function LoggedInDashboard({
  refreshTick,
  onForceRefresh,
}: { refreshTick?: number; onForceRefresh?: () => void }) {
  const { user } = useAuth();
  const [bossListEditMode, setBossListEditMode] = useState(false);
  const [excludedBossIds, setExcludedBossIds] = useState<Set<string>>(new Set());
  const [bossListSaving, setBossListSaving] = useState(false);

  /** 서버 데이터 */
  const [trackedRaw, setTrackedRaw] = useState<BossDto[]>([]);
  const [forgottenRaw, setForgottenRaw] = useState<BossDto[]>([]);
  const [fixedRaw, setFixedRaw] = useState<FixedBossDto[]>([]);
  const [recentList, setRecentList] = useState<RecentTimelineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [recentLoading, setRecentLoading] = useState(true);
  const [cutDefaultAt, setCutDefaultAt] = useState<string>(new Date().toString());

  // 우측 이력 기간(기본 7일)
  const { fromDate: _df, toDate: _dt } = getDateRangeLastNDays(7);
  const [recentFromDate, setRecentFromDate] = useState(_df);
  const [recentToDate, setRecentToDate] = useState(_dt);
  const recentFromRef = useRef<HTMLInputElement | null>(null);
  const recentToRef = useRef<HTMLInputElement | null>(null);

  /** 검색/알림/간편컷 등 기존 상태 유지 */
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // 지남 유지 상태: 보스별 지남 시각(dueAt)과 유지 마감 시각(holdUntil)을 저장
  const overdueStateRef = useRef<Map<string, { dueAt: number; holdUntil: number }>>(new Map());
  const persistOverdueState = () => {
    try {
      const obj: Record<string, { dueAt: number; holdUntil: number }> = {};
      overdueStateRef.current.forEach((v, k) => { obj[k] = v; });
      localStorage.setItem(OVERDUE_STATE_KEY, JSON.stringify(obj));
    } catch {}
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(OVERDUE_STATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, { dueAt: number; holdUntil: number }>;
      const now = Date.now();
      const map = new Map<string, { dueAt: number; holdUntil: number }>();
      Object.entries(parsed).forEach(([k, v]) => {
        if (v && typeof v.dueAt === "number" && typeof v.holdUntil === "number" && now <= v.holdUntil) {
          map.set(k, v);
        }
      });
      overdueStateRef.current = map;
    } catch {}
  }, []);

  // ⬇️ 추가: 액션 후 억제 상태(끝나는 ms) 저장
  const actionSilenceRef = useRef<Map<string, number>>(new Map());
  const recentDazeFeedbackRef = useRef<Map<string, number>>(new Map());


  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem("voiceEnabled");
      return v == null ? true : v === "1";
    } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem("voiceEnabled", voiceEnabled ? "1" : "0"); } catch {} }, [voiceEnabled]);

  const [voiceVolume, setVoiceVolume] = useState<number>(() => {
    try {
      const v = localStorage.getItem("voiceVolume");
      const n = v == null ? 1 : Number(v);
      if (!Number.isFinite(n)) return 1;
      return Math.min(1, Math.max(0, n));
    } catch { return 1; }
  });
  useEffect(() => {
    try { localStorage.setItem("voiceVolume", String(voiceVolume)); } catch {}
  }, [voiceVolume]);

  const [quickCutText, setQuickCutText] = useState("");
  const [quickSaving, setQuickSaving] = useState(false);
  const [commandHelpOpen, setCommandHelpOpen] = useState(false);
  const [uiTick, setUiTick] = useState(0);
  const [updatePopupOpen, setUpdatePopupOpen] = useState(false);
  const [updateHideForever, setUpdateHideForever] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setUiTick((x) => (x + 1) % 3600), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    void loadBosses(bossListEditMode);
    loadRecentHistory();
    const t1 = setInterval(() => { void loadBosses(bossListEditMode); }, 60_000);
    const t2 = setInterval(loadRecentHistory, 60_000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [refreshTick, bossListEditMode]);

  useEffect(() => {
    try {
      localStorage.removeItem("update-popup-hide-until");
      const hidden = localStorage.getItem("update-popup-hide-forever-20260302");
      if (hidden === "1") {
        setUpdatePopupOpen(false);
        return;
      }
    } catch {}
    setUpdatePopupOpen(true);
  }, []);


  const lastNextSpawnRef = useRef<Map<string, number>>(new Map());
  const missedWarnSetRef = useRef<Set<string>>(new Set());
  const timelineIdCacheRef = useRef<Map<string, string>>(new Map());

  const fixedAlertedMapRef = useRef<Map<string, Set<string>>>(new Map());
  const fixedCycleStartRef = useRef<number>(0);

  function isSilenced(id: string, now = Date.now()) {
    return (actionSilenceRef.current.get(id) ?? 0) > now;
  }

  function hasRecentDazeFeedback(id: string, now = Date.now()) {
    const until = recentDazeFeedbackRef.current.get(id) ?? 0;
    if (until <= now) {
      recentDazeFeedbackRef.current.delete(id);
      return false;
    }
    return true;
  }

  // ──────────────── 시간 유틸 (고정보스) ────────────────
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
  function fixedRemainMs(f: FixedBossDto, nowMs = Date.now()) {
    const occ = fixedOccMs(f.genTime, nowMs);
    if (!Number.isFinite(occ)) return Number.POSITIVE_INFINITY;
    return occ - nowMs;
  }

  // 보스 시간 초기화 모달 상태
  const [initOpen, setInitOpen] = useState(false);
  const [initTime, setInitTime] = useState("07:30");
  const [initBusy, setInitBusy] = useState(false);

  // ──────────────── 팝업 상태 ────────────────
  const [cutModalState, setCutModalState] = useState<{ open: boolean; boss: BossDto | null; timelineId: string | null }>({ open: false, boss: null, timelineId: null });
  const [manageModalState, setManageModalState] = useState<{ open: boolean; timelineId: string | null }>({ open: false, timelineId: null });

  // ──────────────── 공통 유틸 ────────────────
  const clearSearch = useCallback(() => {
    setQuery("");
    const el = searchInputRef.current;
    if (el) { el.value = ""; el.blur(); }
  }, []);

  function parseTodayHHMM(hhmm: string): number | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    if (!m) return null;
    const hh = Number(m[1]), mm = Number(m[2]);
    if (hh < 0 || hh > 24 || mm < 0 || mm > 60) return null;
    if (hh === 24 && mm !== 0) return null;
    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    return d.getTime();
  }

  function normalizeInitTimeInput(raw: string): string {
    const digits = raw.replace(/\D/g, "").slice(0, 4);
    if (!digits) return "";

    let hh = digits.slice(0, 2);
    let mm = digits.slice(2, 4);

    if (hh.length === 2) {
      const n = Math.min(24, Number(hh));
      hh = String(Number.isFinite(n) ? n : 0).padStart(2, "0");
    }
    if (hh === "24") {
      mm = "00";
    } else if (mm.length === 2) {
      const n = Math.min(60, Number(mm));
      mm = String(Number.isFinite(n) ? n : 0).padStart(2, "0");
    }

    return mm.length > 0 ? `${hh}:${mm}` : hh;
  }

  function nextFixedOccMs(genTime: number | null | undefined, nowMs = Date.now()): number | null {
    const occ = fixedOccMs(genTime, nowMs);
    if (!Number.isFinite(occ)) return null;
    return (occ as number) <= nowMs ? (occ as number) + DAY : (occ as number);
  }


  /** 서버 로드 */
  async function loadBosses(forEdit = false) {
    setLoading(true);
    try {
      const data = await postJSON<any>("/v1/dashboard/bosses", forEdit ? { forEdit: true } : undefined);
      setTrackedRaw(data.tracked ?? []);
      setForgottenRaw(data.forgotten ?? []);
      setFixedRaw(((data.fixed ?? []) as any[]).map((f) => ({ ...f, genTime: f.genTime == null ? null : Number(f.genTime) })));

      const prevMap = lastNextSpawnRef.current;
      const nextMap = new Map(prevMap);
      for (const b of (data.tracked ?? []) as BossDto[]) {
        const newMs = b.nextSpawnAt ? new Date(b.nextSpawnAt).getTime() : NaN;
        if (Number.isFinite(newMs)) nextMap.set(b.id, newMs as number);
      }
      lastNextSpawnRef.current = nextMap;

      if (DEBUG_FIXED_SORT) {
        console.group("[fixedRaw from backend]");
        console.table((data.fixed ?? []).map((f: any) => ({
          id: String(f.id), name: f.name, genTime: f.genTime, lastCutAt: f.lastCutAt, nextSpawnAt: f.nextSpawnAt ?? null,
        })));
        console.groupEnd();
      }
    } catch {
      setTrackedRaw([]); setForgottenRaw([]); setFixedRaw([]);
    } finally {
      setLoading(false);
    }
  }

  /** 잡은 보스 이력: /v1/boss-timelines (기간 조회) 사용 */
  async function loadRecentHistory() {
    setRecentLoading(true);
    try {
      // 현재 선택된 기간 사용
      const fromDate = recentFromDate;
      const toDate = recentToDate;

      // TimelineList와 동일 구조 요청
      const resp = await postJSON<{ ok: true; items: Array<{
        id: string; bossName: string; cutAt: string; createdBy: string;
        items?: any[]; distributions?: any[];
      }> }>("/v1/boss-timelines", { fromDate, toDate });

      const items: RecentTimelineRow[] = (resp?.items ?? [])
        .filter(x => {
          const { start, end } = kstRangeMs(recentFromDate, recentToDate);
          const cutMs = toMsLoose(x.cutAt);
          return Number.isFinite(cutMs) && cutMs >= start && cutMs <= end;
        })
        .map(x => ({
          id: String(x.id),
          bossName: x.bossName ?? "",
          cutAt: x.cutAt,
          createdBy: x.createdBy ?? null,
          items: x.items ?? [],
          distributions: x.distributions ?? [],
        }))
        .sort((a, b) => new Date(b.cutAt).getTime() - new Date(a.cutAt).getTime())
        .slice(0, 120); // 여유 버퍼

      setRecentList(items);
      } catch (e: any) {
      // ⛑️ 1년 초과 백엔드 에러 메시지 방어
      const msg = e?.message || e?.toString?.() || "";
      if (msg.includes("365") || msg.includes("1년") || msg.includes("최대")) {
        alert("검색 기간은 최대 1년까지만 가능합니다.");
        // 상태는 onChange에서 이미 막히므로 별도 되돌림 불필요
      }
        setRecentList([]);
      } finally {
        setRecentLoading(false);
      }
  }

  function openTimelineManage(timelineId: string | null, bossName: string) {
    const tlId = timelineId ?? null;
    if (!tlId) {
      alert("타임라인을 찾을 수 없습니다.");
      return;
    }
    setManageModalState({ open: true, timelineId: String(tlId) });
  }

  /** 정보입력: 이전에 하던 것처럼 CutModal 띄워서
   *  (루팅 아이템, 루팅자, 참여자, 분배방식) 입력시키는 흐름 */
  function openTimelineInfoInput(timelineId: string | null, bossName: string, cutAtIso?: string) {
    if (!timelineId) {
      alert("타임라인을 찾을 수 없습니다.");
      return;
    }
    setCutDefaultAt(cutAtIso || new Date().toString());
    // CutModal은 boss를 {id,name} 형태로 받게 되어 있으니 최소형으로 전달
    setCutModalState({
      open: true,
      boss: ({ id: "", name: bossName } as any), // 타입 단순화해서 전달
      timelineId: String(timelineId),
    });
  }

  const hasAnyRecord = (b: BossDto) => {
    const serverDaze = (b as any)?.dazeCount ?? 0;
    return !!b.lastCutAt || serverDaze > 0;
  };

  /** 최근 컷 타임라인 id 조회(보스명) */
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

  // 공통 “다음 젠 시각(ms)” 계산
  const { trackedIdSet, forgottenNextMap, allBossesSortedByNext } = useMemo(() => {
    const now = Date.now();
    const trackedIdSet = new Set(trackedRaw.map((b) => b.id));

    const forgottenNextMap = new Map<string, number>();
    for (const b of forgottenRaw) {
      if (!b.lastCutAt || !b.respawn || b.respawn <= 0) { forgottenNextMap.set(b.id, Number.POSITIVE_INFINITY); continue; }
      const lastMs = toMsLoose(b.lastCutAt);
      if (!Number.isFinite(lastMs)) { forgottenNextMap.set(b.id, Number.POSITIVE_INFINITY); continue; }
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

  // 기간 변경 시 즉시 다시 로드
  useEffect(() => {
    loadRecentHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentFromDate, recentToDate]);

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
      const hayCho = toChosung(hay);
      return tokens.every((t) => {
        const tLower = t.toLowerCase();
        if (hayLower.includes(tLower)) return true;
        if (isChosungToken(t)) return hayCho.includes(t);
        return false;
      });
    };
    return allBossesSortedByNext.filter(match);
  }, [query, allBossesSortedByNext]);

  /** ───────── 미입력 계산 ───────── */
  function computeEffectiveMiss(b: BossDto, now = Date.now()): number {
    const respawnMin = Number(b.respawn ?? 0);
    if (!Number.isFinite(respawnMin) || respawnMin <= 0) return 0;
    const respawnMs = respawnMin * 60 * 1000;

    if (!b.lastCutAt) {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      const sinceMidnight = d.getTime();
      const elapsedMin = (now - sinceMidnight) / 60000;
      return Math.max(0, Math.floor(elapsedMin / respawnMin));
    }

    const lastMs = toMsLoose(b.lastCutAt);
    if (!Number.isFinite(lastMs) || now <= lastMs) return 0;

    const overdueMs = now - (lastMs + respawnMs);
    if (overdueMs < OVERDUE_GRACE_MS) return 0;

    const missed = 1 + Math.floor((overdueMs - OVERDUE_GRACE_MS) / respawnMs);
    return missed;
  }

  const remainingMsFor = (b: BossDto) => {
    const now = Date.now();
    const nextMs = getNextMsGeneric(b);
    if (!Number.isFinite(nextMs)) return Number.POSITIVE_INFINITY;

    const diff = nextMs - now; // >0 남음, <0 지남
    const stateMap = overdueStateRef.current;
    const st = stateMap.get(b.id);

    // 1) 지금 막 지남하거나 지남 상태라면: 지남 시각(dueAt) 고정하고 10분 유지
    if (diff <= 0) {
      const dueAt = st?.dueAt ?? nextMs; // 지남 시각 고정
      const holdUntil = st?.holdUntil ?? (dueAt + OVERDUE_GRACE_MS);
      stateMap.set(b.id, { dueAt, holdUntil });
      persistOverdueState();
      if (now <= holdUntil) {
        return -(now - dueAt);
      }
      // 10분 지난 뒤: 다음 젠 예상으로 이동
      stateMap.delete(b.id);
      persistOverdueState();
      const respawnMin = Number(b.respawn ?? 0);
      if (!Number.isFinite(respawnMin) || respawnMin <= 0) return Number.POSITIVE_INFINITY;
      const step = respawnMin * 60 * 1000;
      const k = Math.max(1, Math.ceil((now - dueAt) / step));
      const advancedNext = dueAt + k * step;
      return advancedNext - now;
    }

    // 2) 서버 갱신으로 nextMs가 미래로 밀려도, 유지 중이면 경과시간을 계속 키워서 보여줌
    if (st && now < st.holdUntil) {
      return -(now - st.dueAt); // 지남 경과시간(카운트업)
    }

    // 3) 유지 시간 종료 후 클린업
    if (st && now >= st.holdUntil) stateMap.delete(b.id);

    // 정상 카운트다운
    return diff;
  };

  /** 비고정: 음성 알림(5/1분 전) + 지남 3분 경고(한 번) */
  const [alertedMap, setAlertedMap] = useState<Map<string, Set<number>>>(new Map());
  const normalVoicePrimedRef = useRef(false);
  useEffect(() => {
    if (normalVoicePrimedRef.current || filteredAll.length === 0) return;
    const seeded = new Map<string, Set<number>>();
    for (const b of filteredAll) {
      const r = remainingMsFor(b);
      const set = new Set<number>();
      if (r <= 5 * MIN) set.add(5 * MIN);
      if (r <= 1 * MIN) set.add(1 * MIN);
      if (r <= -MISSED_WARN_MS) missedWarnSetRef.current.add(b.id);
      if (set.size > 0) seeded.set(b.id, set);
    }
    if (seeded.size > 0) setAlertedMap(seeded);
    normalVoicePrimedRef.current = true;
  }, [filteredAll]);
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
        try { await speakKorean(`${x.name} 처리하지 않으면 미입력 보스로 이동합니다.`); } catch { await playBeep(300); }
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
  }, [filteredAll, uiTick, voiceEnabled]);

  async function cutFixedBoss(fb: FixedBossDto) {
    if (!confirm(`${fb.name} 보스를 컷 처리하시겠습니까?`)) return;

    try {
      // 1) 컷 처리
      await postJSON(`/v1/dashboard/bosses/${fb.id}/cut`, {
        cutAtIso: new Date().toISOString(),
        mode: "DISTRIBUTE",
        items: [],
        participants: [],
      });

      // 2) 데이터 갱신
      await loadBosses();
      await loadRecentHistory();
      clearSearch();
      onForceRefresh?.();

      // 3) 방금 생성된 타임라인 찾기
      const { id: timelineId } = await getTimelineIdForBossName(fb.name);
      if (!timelineId) {
        // alert 지우고, 그냥 관리 모달 자동 오픈만 스킵
        //alert("방금 컷한 보스를 찾을 수 없습니다.");
        console.warn("[cutFixedBoss] latest timeline not found for", fb.name);
        return;
      }

      // 4) 보스 컷 관리 팝업 바로 열기
      setManageModalState({
        open: true,
        timelineId: String(timelineId),
      });

    } catch (e: any) {
      alert(e?.message ?? "고정보스 컷 처리 실패");
    }
  }

  function isCutTodayFixed(fb: FixedBossDto): boolean {
    if (!fb.lastCutAt) return false;
    const cutDate = formatDateLocal(new Date(fb.lastCutAt));
    const today = formatDateLocal(new Date());
    return cutDate === today;
  }

  async function runInitCutAt(cutAtIso: string, confirmMessage: string, options?: { closeModal?: boolean; successMessage?: string }) {
    const normals: BossDto[] = [...trackedRaw, ...forgottenRaw];
    const seen = new Set<string>();
    const bosses = normals.filter(b => (seen.has(b.id) ? false : (seen.add(b.id), true)));
    if (bosses.length === 0) { alert("초기화할 보스가 없습니다."); return; }

    if (!confirm(confirmMessage)) return;

    setInitBusy(true);
    try {
      for (const b of bosses) {
        try {
          await postJSON(`/v1/dashboard/bosses/${b.id}/cut`, { cutAtIso, mode: "TREASURY", items: [], participants: [] });
        } catch (e) { console.warn("[init-cut] failed:", b.name, e); }
      }
      for (const b of bosses) {
        const wasNoHistory = !b.lastCutAt && Number((b as any)?.dazeCount ?? 0) === 0;
        if (!wasNoHistory) continue;
        try {
          const timelineId = await getTimelineIdForBossName(b.name);
          if (timelineId?.id) await postJSON(`/v1/boss-timelines/${timelineId.id}/daze`, { atIso: new Date().toString() });
        } catch (e) { console.warn("[init-daze] failed:", b.name, e); }
      }
      alert(options?.successMessage ?? "보스 시간 초기화 완료!");
      await loadBosses();
      await loadRecentHistory();
      clearSearch();
      if (options?.closeModal) setInitOpen(false);
    } finally {
      setInitBusy(false);
    }
  }

  // 보스 초기화(+5분) + ‘이력 전무’ 1회 멍
  async function runInitCutForAll() {
    if (initBusy) return;
    const baseMs = parseTodayHHMM(initTime);
    if (!baseMs) { alert("시간 형식은 HH:mm 입니다. 예) 07:30"); return; }

    const cutAtIso = new Date(baseMs + 5 * 60 * 1000).toString();
    await runInitCutAt(
      cutAtIso,
      `모든 보스를 오늘 ${initTime} + 5분(${new Date(cutAtIso).toLocaleString()})으로 컷 처리합니다.\n'이력 전무' 보스는 1회 멍까지 자동 처리합니다.`,
      { closeModal: true }
    );
  }

  // ──────────────── 공통 도우미 ────────────────
  function delay(ms: number) { return new Promise((res) => setTimeout(res, ms)); }
  const speakQueueRef = useRef<Promise<void>>(Promise.resolve());
  const effectiveVoiceVolume = Math.min(1, 0.35 + voiceVolume * 0.65);

  function playBeep(durationMs = 300) {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return Promise.resolve();
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 980;
    gain.gain.value = Math.min(0.28, 0.12 * Math.max(0.5, effectiveVoiceVolume));
    osc.connect(gain); gain.connect(ctx.destination); osc.start();
    return new Promise<void>((resolve) => {
      setTimeout(() => { osc.stop(); ctx.close().finally(() => resolve()); }, durationMs);
    });
  }

  function pickPreferredKoreanVoice(voices: SpeechSynthesisVoice[]) {
    const koVoices = voices.filter((v) => /ko[-_]KR/i.test(v.lang) || v.lang?.startsWith("ko"));
    if (koVoices.length === 0) return null;

    const score = (v: SpeechSynthesisVoice) => {
      const name = `${v.name} ${v.voiceURI}`.toLowerCase();
      let s = 0;
      if (/google|enhanced|premium|high quality/.test(name)) s += 5;
      if (/samsung|microsoft|apple|siri/.test(name)) s += 3;
      if (/female|여성/.test(name)) s += 1;
      if (v.default) s += 1;
      return s;
    };

    return [...koVoices].sort((a, b) => score(b) - score(a))[0] ?? koVoices[0];
  }

  function speakNow(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ss: SpeechSynthesis | undefined = (window as any).speechSynthesis;
      if (!ss || typeof window === "undefined") return reject(new Error("speechSynthesis not available"));
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "ko-KR"; utter.rate = 1; utter.pitch = 1;
      utter.volume = effectiveVoiceVolume;
      const pickVoice = () => {
        const voices = ss.getVoices?.() || [];
        const ko = pickPreferredKoreanVoice(voices);
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

  function speakKorean(text: string): Promise<void> {
    const job = speakQueueRef.current.then(async () => { await speakNow(text); });
    speakQueueRef.current = job.catch(() => {});
    return job;
  }

  /** 진행/미입력/임박 우선 정렬 */
  function prioritizeForTop(list: BossDto[]) {
    const overdueKeep: BossDto[] = [];
    const soon: BossDto[] = [];
    const rest: BossDto[] = [];

    for (const b of list) {
      const r = remainingMsFor(b);
      if (r < 0 && r >= -OVERDUE_GRACE_MS) overdueKeep.push(b);
      else if (r > 0 && r <= HIGHLIGHT_MS) soon.push(b);
      else rest.push(b);
    }
    const byRemainAsc = (a: BossDto, b: BossDto) => remainingMsFor(a) - remainingMsFor(b);
    overdueKeep.sort(byRemainAsc);
    soon.sort(byRemainAsc);
    rest.sort(byRemainAsc);
    return [...overdueKeep, ...soon, ...rest];
  }

  // 단일 카드 렌더 — 상단 큰 영역(비고정 전체)용으로 컨텍스트 통합
  const [hoverBossId, setHoverBossId] = useState<string | null>(null);
  const toggleExcludedBoss = useCallback((bossId: string) => {
    setExcludedBossIds((prev) => {
      const next = new Set(prev);
      if (next.has(bossId)) next.delete(bossId);
      else next.add(bossId);
      return next;
    });
  }, []);

  const handleBossListEditCardClick = useCallback(async () => {
    if (bossListSaving) return;
    if (!bossListEditMode) {
      try {
        await loadBosses(true);
        setBossListEditMode(true);
      } catch {
        alert("보스 목록을 다시 불러오지 못했습니다.");
      }
      return;
    }
    if (!user?.id || !user?.clanId) {
      alert("사용자/클랜 정보가 없어 저장할 수 없습니다.");
      return;
    }

    const bossMetaIds = Array.from(excludedBossIds).map((id) => {
      const n = Number(id);
      return Number.isFinite(n) ? n : id;
    });

    setBossListSaving(true);
    try {
      const res = await putJSON<{ ok: boolean; savedCount: number }>(
        "/v1/dashboard/boss-visibility/exclusions",
        {
          clanId: user.clanId,
          userId: user.id,
          bossMetaIds,
        }
      );
      alert(`보스 목록 편집 저장 완료 (${res?.savedCount ?? bossMetaIds.length}건)`);
      setBossListEditMode(false);
      await loadBosses();
    } catch (e: any) {
      alert(e?.message ?? "보스 목록 편집 저장 실패");
    } finally {
      setBossListSaving(false);
    }
  }, [bossListEditMode, bossListSaving, excludedBossIds, loadBosses, user?.clanId, user?.id]);

  const cancelBossListEdit = useCallback(() => {
    if (bossListSaving) return;
    setExcludedBossIds(new Set());
    setBossListEditMode(false);
  }, [bossListSaving]);

  function LocationHover({
    text, bossId, hoverBossId, setHoverBossId, disabled = false,
  }: { text?: string | null; bossId: string; hoverBossId: string | null; setHoverBossId: (id: string | null) => void; disabled?: boolean; }) {
    const open = hoverBossId === bossId;
    const btnRef = useRef<HTMLButtonElement | null>(null);
    const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
    const handleButtonMouseEnter = useCallback(() => setHoverBossId(bossId), [setHoverBossId, bossId]);
    const handleButtonMouseLeave = useCallback(() => setHoverBossId(null), [setHoverBossId]);
    const handleTooltipMouseEnter = useCallback(() => setHoverBossId(bossId), [setHoverBossId, bossId]);
    const handleTooltipMouseLeave = useCallback(() => setHoverBossId(null), [setHoverBossId]);

    useEffect(() => {
      if (!open || disabled) { setTooltipPos(null); return; }
      function updatePosition() {
        const btn = btnRef.current;
        if (btn) {
          const rect = btn.getBoundingClientRect();
          setTooltipPos({ top: rect.bottom + window.scrollY + 4, left: rect.left + window.scrollX });
        }
      }
      updatePosition();
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("resize", updatePosition);
      return () => {
        window.removeEventListener("scroll", updatePosition, true);
        window.removeEventListener("resize", updatePosition);
      };
    }, [open, disabled]);

    const tooltipNode =
      !disabled && open && !!text && tooltipPos
        ? createPortal(
            <div
              className="z-[999999] w-[220px] rounded-md border bg-white/95 px-2 py-1 text-[12px] text-slate-700 shadow-lg backdrop-blur-sm whitespace-pre-wrap break-keep"
              style={{ position: "absolute", top: tooltipPos.top, left: tooltipPos.left }}
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
            disabled={disabled}
            ref={btnRef}
            onMouseEnter={disabled ? undefined : handleButtonMouseEnter}
            onMouseLeave={disabled ? undefined : handleButtonMouseLeave}
            className="pointer-events-auto w-full text-center rounded-md border border-white/10 text-[10px] leading-none px-2 py-[3px]
                      bg-white/5 text-white/70 shadow-sm hover:bg-white/10 relative z-[70] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            보스 젠 위치
          </button>
        </div>
        {tooltipNode}
      </>
    );
  }

  function renderTileAll(b: BossDto) {
    const isExcludedInEdit = bossListEditMode && excludedBossIds.has(b.id);
    const remain = remainingMsFor(b);
    const hms = fmtHMS(remain);
    const now = Date.now();
    const silenced = isSilenced(b.id, now);            // ⬅️ 추가
    const isSoon = remain > 0 && remain <= HIGHLIGHT_MS;                 // 5분 이내
    const isWarn10 = remain > HIGHLIGHT_MS && remain <= WARN_10_MS;       // 10분 이내
    const isWarn15 = remain > WARN_10_MS && remain <= WARN_15_MS;         // 15분 이내
    const overdueKeep = remain < 0 && remain >= -OVERDUE_GRACE_MS;       // 지남~10분 유예
    const shouldBlink = !bossListEditMode && !silenced && (isSoon || overdueKeep);
    const blinkCls = shouldBlink
      ? "animate-blink border-2 border-rose-400 bg-rose-500/15"
      : isWarn10
      ? "border border-amber-400/80 bg-amber-500/10"
      : isWarn15
      ? "border border-yellow-300/80 bg-yellow-500/10"
      : "border border-white/10 bg-white/5";

    const canDaze = !!b.isRandom;
    const dazeCount = Number((b as any)?.dazeCount ?? 0);
    const missCount = computeEffectiveMiss(b);
    const showRecentDazeFeedback = hasRecentDazeFeedback(b.id, now);

    const afterLabel = remain < 0 ? "지남" : "뒤 예상";
    const timeLabel = bossListEditMode
      ? "00:00:00"
      : remain < 0
      ? fmtElapsedLabel(remain)
      : (hms == null ? "미입력" : `${hms} ${afterLabel}`);

    return (
      <div key={b.id} className={`relative overflow-visible z-[40] hover:z-[90] rounded-xl shadow-sm p-3 text-sm ${blinkCls}`}>
        {/* 미입력/멍 배지 — 우상단 겹치기 */}
        {!bossListEditMode && ((missCount > 0) || (dazeCount > 0)) && (
          <div className="absolute top-0 right-0 translate-x-1/4 -translate-y-1/4 inline-flex flex-row flex-nowrap whitespace-nowrap items-center gap-2 pointer-events-none z-[95] scale-75">
            {missCount > 0 && (
              <span className="rounded-[8px] border border-sky-300 bg-sky-50/95 px-2 py-0.5 text-[11px] font-semibold text-sky-700 shadow-md">
                미입력 {missCount}
              </span>
            )}
            {missCount === 0 && dazeCount > 0 && (
              <span className="rounded-[6px] border border-amber-300 bg-amber-50/90 px-1.5 py-[1px] text-[10px] font-medium text-amber-700 shadow">
                멍 {dazeCount}
              </span>
            )}
            {showRecentDazeFeedback && (
              <span className="rounded-[6px] border border-emerald-300 bg-emerald-50/90 px-1.5 py-[1px] text-[10px] font-medium text-emerald-700 shadow">
                멍 처리됨
              </span>
            )}
          </div>
        )}
        {bossListEditMode && (
          <button
            type="button"
            onClick={() => toggleExcludedBoss(b.id)}
            className={`absolute top-2 right-2 z-[96] inline-flex h-5 w-5 items-center justify-center rounded-full shadow-sm transition-colors ${
              isExcludedInEdit
                ? "bg-blue-400/80 text-white hover:bg-blue-400"
                : "bg-rose-400/80 text-white hover:bg-rose-400"
            }`}
            title={isExcludedInEdit ? "목록에 다시 추가" : "목록에서 제외"}
            aria-label={isExcludedInEdit ? "목록에 다시 추가" : "목록에서 제외"}
          >
            {isExcludedInEdit ? (
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M12 6v12" />
                <path d="M6 12h12" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M7 7l10 10" />
                <path d="M17 7L7 17" />
              </svg>
            )}
          </button>
        )}

        <div className={isExcludedInEdit ? "grayscale opacity-50 blur-[1px]" : ""}>
          <div className="font-medium text-[13px] whitespace-nowrap overflow-visible text-white">{b.name}</div>
          <div className="text-xs text-white/60 whitespace-nowrap">
            {timeLabel}
          </div>

          <div className="mt-1 grid grid-cols-2 gap-1 items-center">
            {b.isRandom ? (
              <>
                <button
                  type="button"
                  disabled={bossListEditMode}
                  onClick={() => instantCut(b)}
                  className="w-full text-[10px] leading-none px-2 py-[3px] rounded-md text-white bg-rose-500/80 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  컷
                </button>
                <button
                  type="button"
                  disabled={bossListEditMode}
                  onClick={() => addDaze(b)}
                  className="w-full text-[10px] leading-none px-2 py-[3px] rounded-md border border-white/10 text-white/70 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  멍
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={bossListEditMode}
                onClick={() => instantCut(b)}
                className="col-span-2 w-full text-[10px] leading-none px-2 py-[3px] rounded-md text-white bg-rose-500/80 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                컷
              </button>
            )}

            {b.location && (
              <div className="col-span-2 pt-1 w-full">
                <div className="w-full">
                  <LocationHover text={b.location} bossId={b.id} hoverBossId={hoverBossId} setHoverBossId={setHoverBossId} disabled={bossListEditMode} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /** 좌측 그리드: 유예(지남~10분) → 임박(≤5분) → 남은시간↑ */
  const normalsAll = useMemo(() => {
    return prioritizeForTop(filteredAll);
  }, [filteredAll, uiTick]);

  /** 고정 보스 정렬/표시 */
  const fixedSorted = useMemo(() => {
    const now = Date.now();

    type Row = {
      f: FixedBossDto & { nextSpawnAt?: string | null };
      // 남은 시간(ms). nextSpawnAt 있으면 그걸 우선 사용
      remain: number;              // 다음 젠까지 남은 시간 (음수면 지남)
      occ: number;                 // 기준 발생 시각(ms)
      group: 0 | 1 | 2;            // 0: 막 지남(유예), 1: 곧 올 것/대기, 2: 지나간(블루)
      soon: boolean;               // 5분 이내
      overdueKeep: boolean;        // 지남 후 유예(-GRACE 이내)
      isBlue: boolean;             // 잡음/사이클 뒤/유예 지난 뒤
      key: number;                 // 정렬키
    };

    const rows: Row[] = fixedRaw.map((f) => {
      // occ: 오늘 사이클 기준 발생 시각
      const occ = fixedOccMs(f.genTime, now);

      // remain: nextSpawnAt가 있으면 그걸 사용해서 계산, 없으면 occ-now
      let remain = Number.POSITIVE_INFINITY;
      if (f.id === "37" || f.id === "38") {
        const ns = f.nextSpawnAt ? new Date(f.nextSpawnAt).getTime() : NaN;
        remain = Number.isFinite(ns) ? ns - now : (Number.isFinite(occ) ? occ - now : Number.POSITIVE_INFINITY);
      } else {
        remain = Number.isFinite(occ) ? occ - now : Number.POSITIVE_INFINITY;
      }

      const overdueKeep = remain < 0 && remain >= -OVERDUE_GRACE_MS;
      const soon = remain > 0 && remain <= HIGHLIGHT_MS;

      const caught = fixedIsCaughtCycle(f, now);
      const postLast = isPostLastWindow(now);
      const afterGrace = remain <= -OVERDUE_GRACE_MS;
      const isBlue = caught || postLast || afterGrace;

      // 그룹: 0(막 지남, 유예), 1(대기/곧), 2(지나간/블루)
      let group: Row["group"] = 1;
      if (overdueKeep) group = 0;
      else if (isBlue) group = 2;

      // 정렬키:
      //  - group0: |remain| 오름차순 (방금 지난 것부터)
      //  - group1: remain 오름차순 (곧 올수록 앞)
      //  - group2: 다음 occ 오름차순 (참고용)
      let key: number;
      if (group === 0) key = Math.abs(remain);
      else if (group === 1) key = remain;
      else key = occ;

      return { f: f as any, remain, occ, group, soon, overdueKeep, isBlue, key };
    });

    // 정렬: group 0 → 1 → 2, 각 그룹 내부는 key ASC
    rows.sort((a, b) => {
      if (a.group !== b.group) return a.group - b.group;
      return a.key - b.key;
    });

    return rows.map(r => r.f);
  }, [fixedRaw, uiTick]);

  // 고정 보스 음성 알림
  const fixedVoicePrimedRef = useRef(false);
  useEffect(() => {
    if (fixedVoicePrimedRef.current || fixedSorted.length === 0) return;
    const now = Date.now();
    const seeded = new Map<string, Set<string>>();
    for (const f of fixedSorted) {
      const occ = fixedOccMs(f.genTime, now);
      if (!Number.isFinite(occ)) continue;
      const remain = occ - now;
      const set = new Set<string>();
      if (remain <= 5 * MIN) set.add("T5");
      if (remain <= 1 * MIN) set.add("T1");
      if (remain <= 0) set.add("T0");
      if (remain <= -5 * MIN) set.add("T5L");
      if (set.size > 0) seeded.set(f.id, set);
    }
    fixedAlertedMapRef.current = seeded;
    fixedVoicePrimedRef.current = true;
  }, [fixedSorted]);

  useEffect(() => {
    if (!voiceEnabled || fixedSorted.length === 0) return;
    const now = Date.now();
    const curStart = cycleStartMs(now);
    if (fixedCycleStartRef.current !== curStart) {
      fixedAlertedMapRef.current = new Map();
      fixedCycleStartRef.current = curStart;
    }
    const toSpeak: Array<{ id: string; name: string; tag: string; text: string }> = [];
    for (const f of fixedSorted) {
      const occ = fixedOccMs(f.genTime, now);
      if (!Number.isFinite(occ)) continue;
      const remain = occ - now;
      if (occ >= nextCycleStartMs(curStart)) continue;

      const prev = fixedAlertedMapRef.current.get(f.id);
      for (const th of ALERT_THRESHOLDS) {
        const tag = th === 5 * MIN ? "T5" : "T1";
        const text = `${f.name} 보스 젠 ${th === 5 * MIN ? "5분" : "1분"} 전입니다.`;
        if (remain > 0 && remain <= th && !(prev?.has(tag))) toSpeak.push({ id: f.id, name: f.name, tag, text });
      }
      if (remain <= 0 && remain > -5 * MIN && !(prev?.has("T0"))) {
        toSpeak.push({ id: f.id, name: f.name, tag: "T0", text: `${f.name} 보스 젠 시간입니다.` });
      }
      if (remain <= -5 * MIN && !(prev?.has("T5L"))) {
        toSpeak.push({ id: f.id, name: f.name, tag: "T5L", text: `${f.name} 보스 젠 후 5분이 지났습니다.` });
      }
    }
    if (toSpeak.length === 0) return;
    (async () => {
      for (const x of toSpeak) {
        try { await speakKorean(x.text); } catch { await playBeep(250); }
        await delay(100);
      }
    })().catch(() => {});
    for (const x of toSpeak) {
      const set = fixedAlertedMapRef.current.get(x.id) ?? new Set<string>();
      set.add(x.tag);
      fixedAlertedMapRef.current.set(x.id, set);
    }
  }, [fixedSorted, uiTick, voiceEnabled]);

  function findBossByCommandName(nameQuery: string): BossDto | null {
    const q = nameQuery.trim().toLowerCase();
    if (!q) return null;

    const byExact = allBossesSortedByNext.find((b) => b.name.trim().toLowerCase() === q);
    if (byExact) return byExact;

    const byIncludes = allBossesSortedByNext.find((b) => `${b.name} ${b.location ?? ""}`.toLowerCase().includes(q));
    return byIncludes ?? null;
  }

  async function executeBotCommand(rawText: string) {
    const text = rawText.trim();
    if (!text) return;

    if (text === "명령어") {
      setCommandHelpOpen(true);
      setQuickCutText("");
      return;
    }

    if (text.startsWith("-v ")) {
      const message = text.slice(3).trim();
      if (!message) {
        alert("읽을 메세지를 입력해주세요.");
        return;
      }
      await speakKorean(message);
      setQuickCutText("");
      return;
    }

    if (text === "보탐 초기화") {
      const now = new Date();
      const cutAtIso = now.toString();
      await runInitCutAt(
        cutAtIso,
        `모든 보스를 현재 시각(${now.toLocaleString()})으로 컷 처리합니다.\n'이력 전무' 보스는 1회 멍까지 자동 처리합니다.`,
        { successMessage: "보스타임을 현재 시각으로 초기화했습니다." }
      );
      setQuickCutText("");
      return;
    }

    const lower = text.toLowerCase();
    const topBoss = normalsAll[0] ?? null;
    const cutAliases = new Set(["컷", "ㅋ", "z"]);
    const dazeAliases = new Set(["멍", "ㅁ", "a"]);

    if (cutAliases.has(lower)) {
      if (!topBoss) {
        alert("처리할 보스가 없습니다.");
        return;
      }
      const ok = await instantCut(topBoss, false, false);
      if (ok && voiceEnabled) {
        try { await speakKorean(`${topBoss.name} 컷 처리되었습니다.`); } catch {}
      }
      setQuickCutText("");
      return;
    }

    if (dazeAliases.has(lower)) {
      if (!topBoss) {
        alert("처리할 보스가 없습니다.");
        return;
      }
      const ok = await addDaze(topBoss, false, false);
      if (ok && voiceEnabled) {
        try { await speakKorean(`${topBoss.name} 멍 처리되었습니다.`); } catch {}
      }
      setQuickCutText("");
      return;
    }

    const namedCommand = /^(.*?)\s+(컷|멍)$/.exec(text);
    if (namedCommand) {
      const bossName = namedCommand[1]?.trim() ?? "";
      const action = namedCommand[2];
      const boss = findBossByCommandName(bossName);
      if (!boss) {
        alert("입력한 보스명을 찾을 수 없습니다.");
        return;
      }
      if (action === "컷") {
        const ok = await instantCut(boss, false, false);
        if (ok && voiceEnabled) {
          try { await speakKorean(`${boss.name} 컷 처리되었습니다.`); } catch {}
        }
      } else {
        const ok = await addDaze(boss, false, false);
        if (ok && voiceEnabled) {
          try { await speakKorean(`${boss.name} 멍 처리되었습니다.`); } catch {}
        }
      }
      setQuickCutText("");
      return;
    }

    alert("지원 명령어: -v 메세지 / 보탐 초기화 / [보스명] 컷 / [보스명] 멍 / 컷(ㅋ,z) / 멍(ㅁ,a)");
  }

  async function submitQuickCut() {
    if (quickSaving) return;

    setQuickSaving(true);
    try {
      await executeBotCommand(quickCutText);
    } catch (e: any) {
      alert(e?.message ?? "명령 실행 실패");
    } finally {
      setQuickSaving(false);
    }
  }

  // 즉시 컷
  async function instantCut(b: BossDto, force = false, announce = true): Promise<boolean> {
    try {
      const res = await postJSON<{ ok?: boolean; needsConfirm?: boolean; by?: string; action?: string; message?: string }>(
        `/v1/dashboard/bosses/${b.id}/cut`,
        { cutAtIso: new Date().toString(), mode: "TREASURY", items: [], participants: [], force }
      );
      if (res?.needsConfirm && !force) {
        const ok = window.confirm(`${res.by ?? "다른 유저"}님이 이미 ${res.action ?? "컷"} 처리 했습니다. 덮어 씌우시겠습니까?`);
        if (ok) return await instantCut(b, true, announce);
        return false;
      }
      if (res?.ok === false) {
        alert(res?.message ?? "즉시 컷 처리에 실패했습니다.");
        return false;
      }
      try { if (announce && voiceEnabled) await speakKorean(`${b.name} 컷 처리되었습니다.`); } catch {}

      // ⬇️ 추가: 지남 유지/경고 상태 해제 + 10분 억제 ON
      overdueStateRef.current.delete(b.id);
      missedWarnSetRef.current.delete(b.id);
      setAlertedMap(prev => { const next = new Map(prev); next.delete(b.id); return next; });
      actionSilenceRef.current.set(b.id, Date.now() + ACTION_SILENCE_MS);

      await loadBosses();
      await loadRecentHistory();
      clearSearch();
      onForceRefresh?.();
      return true;
    } catch (e: any) {
      alert(e?.message ?? "즉시 컷 실패");
      return false;
    }
  }

  // 멍
  async function addDaze(b: BossDto, force = false, announce = true): Promise<boolean> {
    if (computeEffectiveMiss(b) > 0) {
      alert("미입력 된 보스는 멍 처리 할 수 없습니다.");
      return false;
    }
    try {
      // 멍 기록 (백엔드가 타임라인 생성/갱신)
      const clanId = user?.clanId ?? localStorage.getItem("clanId");
      const res = await postJSON<{ ok?: boolean; needsConfirm?: boolean; by?: string; action?: string; message?: string }>(
        `/v1/dashboard/bosses/${b.id}/daze`,
        { atIso: new Date().toString(), clanId: clanId ?? undefined, force }
      );
      if (res?.needsConfirm && !force) {
        const ok = window.confirm(`${res.by ?? "다른 유저"}님이 이미 ${res.action ?? "멍"} 처리 했습니다. 덮어 씌우시겠습니까?`);
        if (ok) return await addDaze(b, true, announce);
        return false;
      }
      if (res?.ok === false) {
        alert(res?.message ?? "멍 처리에 실패했습니다.");
        return false;
      }
      try { if (announce && voiceEnabled) await speakKorean(`${b.name} 멍 처리되었습니다.`); } catch {}

      // ⬇️ 컷/멍 직후 처리: 지남 유지/알림 상태 정리 + 10분 억제 ON
      overdueStateRef.current.delete(b.id);                 // 0분 0초 카운트업(지남 유지) 즉시 해제
      missedWarnSetRef.current.delete(b.id);                // "미입력 이동" 음성 경고 재발 방지 잔여 상태 제거
      setAlertedMap((prev) => {                             // 5/1분 알림 임계값 기록 초기화
        const next = new Map(prev);
        next.delete(b.id);
        return next;
      });
      actionSilenceRef.current.set(b.id, Date.now() + ACTION_SILENCE_MS); // 10분간 깜빡임/상단고정 억제
      recentDazeFeedbackRef.current.set(b.id, Date.now() + 10_000);

      // 최신 데이터 반영
      await loadBosses();
      await loadRecentHistory();
      clearSearch();
      onForceRefresh?.();
      return true;
    } catch (e: any) {
      alert(e?.message ?? "멍 기록에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      return false;
    }
  }

  /** 공유/가져오기 */
  const [shareOpen, setShareOpen] = useState(false);
  const [shareText, setShareText] = useState("");
  function openShareModal() {
    const lines: string[] = [];
    const normals: BossDto[] = [...trackedRaw, ...forgottenRaw];
    const seen = new Set<string>();
    const bosses = normals.filter(b => (seen.has(b.id) ? false : (seen.add(b.id), true)));
    for (const b of bosses) {
      const nextMs = getNextMsGeneric(b);
      const nextStr = fmtTimeHM(Number.isFinite(nextMs) ? nextMs : null);
      const miss = computeEffectiveMiss(b);
      lines.push(`${nextStr} ${b.name} (미입력${miss}회)`);
    }
    setShareText(lines.join("\n"));
    setShareOpen(true);
  }
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");

  /** ───────── 레이아웃 ─────────
   * 전체 화면을 상단 80%(좌80%+우20%) + 하단 20%(고정보스)로 구성
   */
  return (
    <div className="h-full min-h-0 overflow-hidden flex flex-col">

      {/* 상단 80% */}
      <div className="flex-[8.5] min-h-0 grid grid-cols-[4fr_1fr] gap-4 overflow-hidden">
        {/* 좌측: 비고정 보스 전체 */}
        <section className="overflow-y-auto p-2">
          <h2 className="text-base font-semibold mb-2 text-white/80">
            보스타임 관리
            {query && (
              <span className="ml-2 text-xs text-white/50">
                ({normalsAll.length}개)
              </span>
            )}
          </h2>

      {/* ── 상단 컨트롤 바: 검색 / 음성 on/off / 간편컷 / 보스 초기화 / 디코 공유·가져오기 ── */}
      <div className="sticky top-0 z-[60] bg-slate-900/70 backdrop-blur px-2 py-2 rounded-md border border-white/10 text-white">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 flex-wrap">
          {/* 검색 */}
          <div className="relative w-auto min-w-[160px] max-w-[220px]">
            <input
              ref={searchInputRef}
              className="w-full border border-white/10 bg-white/5 rounded-xl px-2 py-1.5 pr-6 text-sm text-white placeholder:text-white/50"
              placeholder="보스 검색 (초성가능)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-white/50 hover:text-white"
                onClick={() => setQuery("")}
                aria-label="검색어 지우기"
                title="지우기"
              >
                ×
              </button>
            )}
          </div>

          {/* 칸막이 */}
          <div className="h-6 border-l border-white/10 mx-1.5" />

          {/* 음성 알림 on/off */}
          <label className="flex items-center gap-2 text-sm select-none">
            <input
              type="checkbox"
              checked={voiceEnabled}
              onChange={(e) => setVoiceEnabled(e.currentTarget.checked)}
            />
            음성 알림
          </label>

          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(voiceVolume * 100)}
            onChange={(e) => setVoiceVolume(Number(e.currentTarget.value) / 100)}
            disabled={!voiceEnabled}
            className="w-[120px]"
            aria-label="음성 알림 볼륨"
            title="볼륨"
          />
          <span className="text-xs text-white/50 w-[36px]">
            {Math.round(voiceVolume * 100)}%
          </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
            <input
              className="w-full border border-white/10 bg-white/5 rounded-xl px-4 py-2 text-white placeholder:text-white/50"
              placeholder='보탐봇 명령어 입력 "명령어" 라고 입력하면 명령어 목록이 나옵니다.'
              value={quickCutText}
              onChange={(e) => setQuickCutText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.nativeEvent as KeyboardEvent).isComposing || e.keyCode === 229) return;
                if (e.key === "Enter") { e.preventDefault(); submitQuickCut(); }
              }}
            />
            </div>

            {/* 보스 초기화 (모달 열기) */}
            <button
              type="button"
              className="shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/10 text-white text-sm hover:bg-white/15"
              onClick={() => setInitOpen(true)}
              title="모든 보스를 지정 시각(+5분)으로 일괄 컷"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 4v6h6M20 20v-6h-6M20 4h-6V2m0 0a8 8 0 010 16m0-16a8 8 0 100 16" />
              </svg>
              보스 초기화
            </button>

            {/* 디코 보스봇 시간 공유 (모달 열기) */}
            <button
              type="button"
              className="shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/10 text-white text-sm hover:bg-white/15"
              onClick={openShareModal}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 12v.01M4 6v.01M4 18v.01M12 6v12m0 0l-4-4m4 4l4-4" />
              </svg>
              디코에게 공유
            </button>

            {/* 디코 보스봇 시간 가져오기 (모달 열기) */}
            <button
              type="button"
              className="shrink-0 flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/10 text-white text-sm hover:bg-white/15"
              onClick={() => setImportOpen(true)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M20 12v.01M20 6v.01M20 18v.01M12 18V6m0 0l-4 4m4-4l4 4" />
              </svg>
              디코에서 가져오기
            </button>
          </div>
        </div>
      </div>

          {loading ? (
            <div className="h-12 rounded-xl border border-white/10 bg-white/5 flex items-center px-3 text-sm text-white/60">
              불러오는 중…
            </div>
          ) : normalsAll.length === 0 ? (
            <div className="mt-3 h-12 rounded-xl border border-white/10 bg-white/5 flex items-center px-3 text-sm text-white/50 italic">
              {query ? "검색 결과가 없습니다." : "표시할 보스가 없습니다."}
            </div>
          ) : (
            <div
              className="grid gap-2 px-2 py-3 isolate justify-start"
              style={{
                // 카드 폭 고정: 160px. (더 작게 하고 싶으면 140~150px로 낮추면 됨)
                gridTemplateColumns: "repeat(auto-fill, minmax(120px, 120px))",
              }}
            >
              {normalsAll.map((b) => renderTileAll(b))}
              <div
                onClick={() => void handleBossListEditCardClick()}
                className="relative overflow-visible z-[40] hover:z-[90] rounded-xl shadow-sm p-3 text-sm border border-white/10 bg-white/5 cursor-pointer"
              >
                <div className="flex h-full min-h-[72px] items-center justify-center text-center text-[13px] font-medium text-blue-300">
                  {bossListEditMode ? (bossListSaving ? "저장 중..." : "저장") : "보스 목록 편집"}
                </div>
              </div>
              {bossListEditMode && (
                <div
                  onClick={cancelBossListEdit}
                  className="relative overflow-visible z-[40] hover:z-[90] rounded-xl shadow-sm p-3 text-sm border border-white/10 bg-white/5 cursor-pointer"
                >
                  <div className="flex h-full min-h-[72px] items-center justify-center text-center text-[13px] font-medium text-white/80">
                    취소
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* 우측: 잡은 보스 이력 */}
        <aside className="overflow-y-auto overflow-x-hidden border-l border-white/10 pl-3 pr-4 [scrollbar-gutter:stable_both-edges]">
          <h2 className="text-base font-semibold mb-2 text-white/80">잡은 보스 이력</h2>

          {/* 기간 표시(텍스트) + 달력 버튼: 한 줄 */}
          <div className="mb-2 sticky top-0 z-10 bg-slate-900/70 backdrop-blur px-1 py-1 rounded border border-white/10">
            <div className="flex items-center gap-2 text-[11px] text-white/70">
              <span className="px-1 py-[2px] rounded bg-white/10 border border-white/10 text-white/80">{recentFromDate}</span>
              <button
                type="button"
                className="ml-1 inline-flex items-center gap-1 px-2 py-[4px] rounded border border-white/10 text-white/80 hover:bg-white/10"
                title="From 날짜 변경"
                onClick={() => {
                  const el = recentFromRef.current;
                  if (!el) return;
                  (el as any).showPicker?.() ?? el.focus();
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeWidth="2" d="M8 2v3M16 2v3M3 8h18M5 12h14M5 16h10" />
                </svg>
              </button>
              <span className="shrink-0">~</span>
              <span className="px-1 py-[2px] rounded bg-white/10 border border-white/10 text-white/80">{recentToDate}</span>

              {/* To 버튼 + 투명 date input(앵커) */}
              <div className="relative">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 px-2 py-[4px] rounded border border-white/10 text-white/80 hover:bg-white/10"
                  title="To 날짜 변경"
                  onClick={() => {
                    const el = recentToRef.current;
                    if (!el) return;
                    (el as any).showPicker?.() ?? el.focus();
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeWidth="2" d="M8 2v3M16 2v3M3 8h18M5 12h14M5 16h10" />
                  </svg>
                </button>
              </div>

              {/* From 버튼 + 투명 date input(앵커) */}
              <div className="relative">
                <input
                  ref={recentFromRef}
                  type="date"
                  value={recentFromDate}
                  // ✅ 'from'은 선택 가능한 최소/최대 범위를 'to' 기준 1년으로 제한
                  min={addDaysStr(recentToDate, -365)}
                  max={recentToDate}
                  onChange={(e) => {
                    const nextFrom = e.currentTarget.value;
                    if (!nextFrom) return;
                    if (daysBetweenInclusive(nextFrom, recentToDate) > 365) {
                      alert("검색 기간은 최대 1년까지만 가능합니다.");
                      // 상태는 그대로 두고(유효하지 않으니) input 값도 되돌림
                      e.currentTarget.value = recentFromDate;
                      return;
                    }
                    setRecentFromDate(nextFrom);
                  }}
                  className="absolute top-full left-0 w-px h-px opacity-0"
                />
                <input
                  ref={recentToRef}
                  type="date"
                  value={recentToDate}
                  // ✅ 'to'는 'from' 기준 1년을 넘지 못하도록 제한
                  min={recentFromDate}
                  max={addDaysStr(recentFromDate, 365)}
                  onChange={(e) => {
                    const nextTo = e.currentTarget.value;
                    if (!nextTo) return;
                    if (daysBetweenInclusive(recentFromDate, nextTo) > 365) {
                      alert("검색 기간은 최대 1년까지만 가능합니다.");
                      e.currentTarget.value = recentToDate;
                      return;
                    }
                    setRecentToDate(nextTo);
                  }}
                  className="absolute top-full left-0 w-px h-px opacity-0"
                />
              </div>
            </div>
          </div>

          {recentLoading ? (
            <div className="h-12 rounded-xl border border-white/10 bg-white/5 flex items-center px-3 text-sm text-white/60">
              불러오는 중…
            </div>
          ) : recentList.length === 0 ? (
            <div className="mt-3 h-12 rounded-xl border border-white/10 bg-white/5 flex items-center px-3 text-sm text-white/50 italic">
              최근 컷 이력이 없습니다.
            </div>
          ) : (
            (() => {
              const enriched = recentList.map(r => ({ row: r, action: calcAction(r) }));
              const needAction = enriched
                .filter(x => x.action.pin)
                .sort((a, b) => new Date(b.row.cutAt).getTime() - new Date(a.row.cutAt).getTime());
              const others = enriched
                .filter(x => !x.action.pin)
                .sort((a, b) => new Date(b.row.cutAt).getTime() - new Date(a.row.cutAt).getTime());

              const btnClass = (tone: "default" | "warning" | "success") => {
                if (tone === "warning") return "px-2 py-[6px] text-[12px] rounded-md bg-orange-400 text-white hover:opacity-90";
                if (tone === "success") return "px-2 py-[6px] text-[12px] rounded-md bg-emerald-500 text-white";
                return "px-2 py-[6px] text-[12px] rounded-md border border-white/10 text-white/80 hover:bg-white/10";
              };

              const Item = ({r, act}: { r: RecentTimelineRow; act: ReturnType<typeof calcAction> }) => (
                <li key={`${r.id}-${r.cutAt}`} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm shadow-sm text-white/80">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium truncate text-white">{r.bossName}</div>
                    <div className="text-[11px] text-white/60 whitespace-nowrap">
                      {fmtTimeHM(r.cutAt)}
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <div className="text-[11px] text-white/60">{new Date(r.cutAt).toLocaleString()}</div>
                    <button
                      className={btnClass(act.tone)}
                      onClick={async () => {
                        // id가 있으면 그대로, 없으면 보스명으로 최신 타임라인 조회
                        const tlId = r.id || (await getTimelineIdForBossName(r.bossName)).id || null;
                        if (act.label === "정보입력") {
                          openTimelineInfoInput(tlId, r.bossName, r.cutAt);
                        } else {
                          openTimelineManage(tlId, r.bossName);
                        }
                      }}
                    >
                      {act.label}
                    </button>
                  </div>
                </li>
              );

              return (
                <div className="space-y-3">
                  {/* 고정 섹션(판매중/분배미완) */}
                  {needAction.length > 0 && (
                    <div>
                      <div className="mb-1 text-[11px] text-orange-300 font-semibold">처리 필요</div>
                      <ul className="space-y-2">
                        {needAction.map(x => <Item key={x.row.id + x.row.cutAt} r={x.row} act={x.action} />)}
                      </ul>
                      <div className="my-2 border-t border-white/10" />
                    </div>
                  )}

                  {/* 그 외(정보입력/분배완료) */}
                  <ul className="space-y-2">
                    {others.map(x => <Item key={x.row.id + x.row.cutAt} r={x.row} act={x.action} />)}
                  </ul>
                </div>
              );
            })()
          )}
        </aside>
      </div>

      {/* 하단 20%: 고정 보스 */}
      <div className="relative z-[500] flex-[1.6] min-h-0 border-t border-white/10 mt-3 pt-2 px-3">
        <h2 className="text-base font-semibold mb-2 text-white/80">
          고정 보스
        </h2>
        {loading ? (
          <div className="h-12 rounded-xl border border-white/10 bg-white/5 flex items-center px-3 text-sm text-white/60">
            불러오는 중…
          </div>
        ) : fixedSorted.length === 0 ? (
          <div className="mt-3 h-12 rounded-xl border border-white/10 bg-white/5 flex items-center px-3 text-sm text-white/50 italic">
            고정 보스가 없습니다.
          </div>
        ) : (
          <div className="overflow-x-auto overflow-y-hidden px-1">
            <div className="flex gap-3 pb-3 pr-2">
            {fixedSorted.map((fb) => {
              const now = Date.now();
              const remain = fixedRemainMs(fb, now);
              const overdueKeep = remain < 0 && remain >= -OVERDUE_GRACE_MS;
              const soon = remain > 0 && remain <= HIGHLIGHT_MS;
              const warn10 = remain > HIGHLIGHT_MS && remain <= WARN_10_MS;
              const warn15 = remain > WARN_10_MS && remain <= WARN_15_MS;
              const afterGrace = remain <= -OVERDUE_GRACE_MS;
              const isCaught = fixedIsCaughtCycle(fb, now);
              const postLast = isPostLastWindow(now);

              const isBlue = isCaught || postLast || afterGrace;
              const isRed = soon || overdueKeep;
              const wrapClass = isRed
                ? "relative z-[510] shrink-0 w-[220px] rounded-xl border border-rose-400/70 shadow-sm p-3 text-sm ring-2 ring-rose-400 bg-rose-500/15 animate-blink"
                : warn10
                ? "relative z-[510] shrink-0 w-[220px] rounded-xl border border-amber-400/80 shadow-sm p-3 text-sm ring-2 ring-amber-400/60 bg-amber-500/10"
                : warn15
                ? "relative z-[510] shrink-0 w-[220px] rounded-xl border border-yellow-300/80 shadow-sm p-3 text-sm ring-2 ring-yellow-300/60 bg-yellow-500/10"
                : isBlue
                ? "relative z-[510] shrink-0 w-[220px] rounded-xl border border-sky-300/60 shadow-sm p-3 text-sm ring-2 ring-sky-300 bg-sky-500/10"
                : "relative z-[510] shrink-0 w-[220px] rounded-xl border border-white/10 shadow-sm p-3 text-sm bg-white/5";

              const showCountdown = remain > 0 && remain <= HIGHLIGHT_MS;

              // ⬇️ 추가: 하루에 한 번 뜨는 보스인지 + 오늘 이미 컷했는지
              const isDailyBoss = Number(fb.respawn ?? 0) === 1440;
              const cutToday = isDailyBoss && isCutTodayFixed(fb);

                return (
                  <div key={fb.id} className={wrapClass}>
                  <div className="flex items-center justify-between">
                    <div className="font-medium truncate text-white">{fb.name}</div>
                    <div className="text-xs text-white/60 ml-2 truncate max-w-[110px]">
                      {fb.location}
                    </div>
                  </div>

                  {/* 젠 시각 + 컷 버튼 한 줄 */}
                  <div className="mt-1 flex items-center justify-between text-xs text-white/70 gap-2">
                    {/* 젠 시각 영역 */}
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="shrink-0">젠 시각:</span>
                      <span className="font-semibold truncate">
                        {(() => {
                          const ns = (fb as any).nextSpawnAt as
                            | string
                            | null
                            | undefined;
                          if (ns) {
                            const t = new Date(ns).getTime();
                            return fmtTimeHM(Number.isFinite(t) ? t : null) ?? "—";
                          }
                          if (fb.genTime != null) return fmtDaily(fb.genTime);
                          return "—";
                        })()}
                      </span>
                    </div>

                    {/* 버튼 영역 (젠 시각 오른쪽) */}
                    <div className="shrink-0 flex items-center gap-2">
                      {showCountdown && (
                        <span className="text-[11px] px-2 py-0.5 rounded-md border border-white/10 bg-white/10 backdrop-blur-sm shadow-sm text-white/80">
                          {fmtMMSS2(remain)} 남음
                        </span>
                      )}
                      {isDailyBoss && cutToday ? (
                        <button
                          type="button"
                          disabled
                          className="px-2 py-[3px] rounded-md bg-emerald-500 text-white text-[10px] cursor-default"
                        >
                          금일 보스 컷
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => cutFixedBoss(fb)}
                          className="px-2 py-[3px] rounded-md bg-rose-500/80 text-white text-[10px] hover:bg-rose-500"
                        >
                          컷
                        </button>
                      )}
                    </div>
                  </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

            {/* ── 보스 시간 초기화 모달 ── */}
      {initOpen && (
        <Modal
          open={initOpen}
          onClose={() => setInitOpen(false)}
          title="보스 시간 초기화"
          maxWidth="max-w-[420px]"
        >
          <p className="text-[12px] text-white/70 mb-3">
            입력한 시간의 <b>+ 5분</b>으로 오늘 날짜에 모든 보스를 컷합니다.<br />
            <b>컷/멍 이력이 없던 보스</b>는 이번 1회에 한해 자동으로 멍 처리합니다.
          </p>

          <div className="flex items-center gap-2">
            <input
              className="ui-input w-[130px] text-center"
              placeholder="07:30"
              value={initTime}
              inputMode="numeric"
              maxLength={5}
              onChange={(e) => setInitTime(normalizeInitTimeInput(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); runInitCutForAll(); }
              }}
            />
            <button
              type="button"
              className="px-3 py-2 rounded-xl bg-white/15 text-white hover:bg-white/20 disabled:opacity-60"
              onClick={runInitCutForAll}
              disabled={initBusy}
            >
              {initBusy ? "처리 중…" : "시간 초기화"}
            </button>
            <button
              type="button"
              className="px-3 py-2 rounded-xl border border-white/10 hover:bg-white/10"
              onClick={() => setInitOpen(false)}
            >
              취소
            </button>
          </div>

          <div className="mt-3 text-[11px] text-white/50">예) 07:30 → 오늘 07:35로 일괄 컷</div>
        </Modal>
      )}

      <Modal
        open={commandHelpOpen}
        onClose={() => setCommandHelpOpen(false)}
        title="보탐봇 명령어"
        maxWidth="max-w-[560px]"
      >
        <pre className="whitespace-pre-wrap text-sm leading-7 text-white/85">{BOT_COMMAND_HELP}</pre>
      </Modal>

      {/* ── 디코 보스탐 가져오기 모달 ── */}
      {importOpen && (
        <Modal
          open={importOpen}
          onClose={() => setImportOpen(false)}
          title="디코 보스탐 정보 가져오기"
          maxWidth="max-w-[600px]"
        >
          <textarea
            className="w-full border border-white/10 bg-white/5 rounded p-2 text-sm font-mono h-64 text-white/85 placeholder:text-white/40"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={`예)\n14:32 녹샤 (미입력0회)\n14:32 서드 (미입력0회)\n...`}
          />
          <div className="flex justify-end gap-2 mt-3">
            <button className="px-3 py-2 rounded-xl border border-white/10 hover:bg-white/10" onClick={() => setImportOpen(false)}>
              취소
            </button>
            <button
              className="px-3 py-2 rounded-xl bg-white/15 text-white hover:bg-white/20"
              onClick={async () => {
                try {
                  await postJSON("/v1/dashboard/import-discord", { text: importText });
                  alert("보스탐 데이터가 반영되었습니다.");
                  setImportOpen(false);
                  await loadBosses();
                  onForceRefresh?.();
                } catch (e: any) {
                  alert(e?.message ?? "업로드 실패");
                }
              }}
            >
              저장
            </button>
          </div>
        </Modal>
      )}

      {/* ── 디코 보스탐 공유 모달 ── */}
      {shareOpen && (
        <Modal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          title="디코 보스탐 공유"
          maxWidth="max-w-[520px]"
        >
          <textarea className="flex-1 w-full border border-white/10 bg-white/5 rounded p-2 text-sm font-mono resize-none text-white/85" rows={15} readOnly value={shareText} />

          <div className="flex justify-end gap-2 mt-3">
            <button
              type="button"
              className="px-3 py-2 rounded-xl bg-white/15 text-white hover:bg-white/20"
              onClick={() => {
                navigator.clipboard.writeText(shareText).then(() => alert("복사 완료!"));
              }}
            >
              복사
            </button>
            <button type="button" className="px-3 py-2 rounded-xl border border-white/10 hover:bg-white/10" onClick={() => setShareOpen(false)}>
              닫기
            </button>
          </div>
        </Modal>
      )}

      {/* ── 보스 컷 관리 모달 ── */}
      {manageModalState.open && (
        <BossCutManageModal
          open={manageModalState.open}
          timelineId={manageModalState.timelineId}
          onClose={() => setManageModalState({ open: false, timelineId: null })}
          onSaved={() => {
            // 저장 후 상단/우측 데이터 갱신
            loadBosses();
            loadRecentHistory();
            setManageModalState({ open: false, timelineId: null });
          }}
        />
      )}

      {/* ── 보스 정보 입력 모달(CutModal) ── */}
      {cutModalState.open && (
        <CutModal
          open={cutModalState.open}
          boss={cutModalState.boss as any}
          timelineId={cutModalState.timelineId}
          defaultCutAt={cutDefaultAt}
          onClose={() => setCutModalState({ open: false, boss: null, timelineId: null })}
          onSaved={() => {
            loadBosses();
            loadRecentHistory();
            setCutModalState({ open: false, boss: null, timelineId: null });
          }}
        />
      )}

      {/* 기능 업데이트 안내 팝업 */}
      {updatePopupOpen && (
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50"
          aria-modal="true"
          role="dialog"
        >
          <div className="relative rounded-2xl border border-white/10 bg-slate-900/90 text-white shadow-xl w-[520px] max-w-[92vw] p-6 backdrop-blur">
            <h2 className="text-lg font-bold mb-3">업데이트 공지 2026.03.02</h2>

            <div className="text-sm text-white/80 space-y-3">
              <div>
                <div className="font-semibold">1. 디코 명령어를 사용할 수 있게 기능이 추가 되었습니다.</div>
                <div className="ml-4 mt-1 space-y-1">
                  <div>- PC화면 상단 검색조건에 위치</div>
                  <div>- 모바일 화면 하단 버튼 위에 위치</div>
                  <div>- "명령어" 라고 입력하면 명령어 리스트를 확인할 수 있습니다.</div>
                </div>
              </div>
              <div>2. 멍 / 미입력이 동시에 존재하는 문제를 없앴습니다. 미입력인 경우 멍 횟수가 보이지 않습니다.</div>
              <div>3. 미입력 보스는 멍 처리 할 수 없도록 변경했습니다.</div>
              <div>4. 보스 목록 편집 기능에 "취소" 기능을 넣었습니다.</div>
              <div>5. 혈맹별 디스코드 링크 입력기능을 추가했습니다. PC 화면에서 확인 가능하며, 상단 우측에 위치해 있습니다.</div>
              <div>6. 고정보스도 음성 안내 되도록 변경했습니다.</div>
            </div>

            <div className="mt-6 flex items-center justify-between gap-3">
              <div>
                <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={updateHideForever}
                    onChange={(e) => setUpdateHideForever(e.currentTarget.checked)}
                    className="w-4 h-4 accent-emerald-400"
                  />
                  다시 열지 않기
                </label>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="px-4 py-2 text-sm rounded border border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
                  onClick={() => setUpdatePopupOpen(false)}
                >
                  닫기
                </button>
                <button
                  type="button"
                  className="px-4 py-2 text-sm rounded bg-white text-slate-900 hover:bg-emerald-100"
                  onClick={() => {
                    if (updateHideForever) {
                      try {
                        localStorage.setItem("update-popup-hide-forever-20260302", "1");
                      } catch {}
                    }
                    setUpdatePopupOpen(false);
                  }}
                >
                  확인
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
