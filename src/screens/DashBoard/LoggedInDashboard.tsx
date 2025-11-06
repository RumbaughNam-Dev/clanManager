import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { postJSON } from "@/lib/http";
import type { BossDto } from "../../types";

import BossCutManageModal from "@/components/modals/BossCutManageModal";
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
// 비고정: 지남 유예(파랑 유지) 5분
const OVERDUE_GRACE_MS = 10 * MIN;

// ⬇️ 추가: 컷/멍 직후 깜빡임 & 상단고정 억제 시간(요구: 10분)
const ACTION_SILENCE_MS = OVERDUE_GRACE_MS;

// 비고정: 지남 3분째 경고 음성(한 번만)
const MISSED_WARN_MS = 3 * MIN;

/** 배지 오버레이 위치(카드 기준 비율) — 요구 반영: 우상단 테두리 겹치기 */
const BADGE_LEFT = "80%";
const BADGE_TOP  = "33.333%";

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
// 최근 N일(from~to) 기본 범위 만들기 (기본 7일)
function getDateRangeLastNDays(n = 7) {
  const today = new Date();
  const from = new Date(today.getTime() - n * 24 * 60 * 60 * 1000);
  return { fromDate: formatDateLocal(from), toDate: formatDateLocal(today) };
}

// 두 날짜(YYYY-MM-DD)의 '일수 차이(포함형)' — from~to가 31일 이하면 OK
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

  // ⬇️ 추가: 액션 후 억제 상태(끝나는 ms) 저장
  const actionSilenceRef = useRef<Map<string, number>>(new Map());

  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem("voiceEnabled");
      return v == null ? true : v === "1";
    } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem("voiceEnabled", voiceEnabled ? "1" : "0"); } catch {} }, [voiceEnabled]);

  const [quickCutText, setQuickCutText] = useState("");
  const [quickSaving, setQuickSaving] = useState(false);
  const [uiTick, setUiTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setUiTick((x) => (x + 1) % 3600), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    loadBosses();
    loadRecentHistory();
    const t1 = setInterval(loadBosses, 60_000);
    const t2 = setInterval(loadRecentHistory, 60_000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [refreshTick]);

  const lastNextSpawnRef = useRef<Map<string, number>>(new Map());
  const missedWarnSetRef = useRef<Set<string>>(new Set());
  const timelineIdCacheRef = useRef<Map<string, string>>(new Map());

  const fixedAlertedMapRef = useRef<Map<string, Set<number>>>(new Map());
  const fixedCycleStartRef = useRef<number>(0);

  function isSilenced(id: string, now = Date.now()) {
    return (actionSilenceRef.current.get(id) ?? 0) > now;
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
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    return d.getTime();
  }

  function nextFixedOccMs(genTime: number | null | undefined, nowMs = Date.now()): number | null {
    const occ = fixedOccMs(genTime, nowMs);
    if (!Number.isFinite(occ)) return null;
    return (occ as number) <= nowMs ? (occ as number) + DAY : (occ as number);
  }

  /** 서버 로드 */
  async function loadBosses() {
    setLoading(true);
    try {
      const data = await postJSON<any>("/v1/dashboard/bosses");
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
        // ⛑️ 31일 초과 백엔드 에러 메시지 방어
        const msg = e?.message || e?.toString?.() || "";
        if (msg.includes("31일") || msg.includes("최대 31일")) {
          alert("검색 기간은 최대 31일까지만 가능합니다.");
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
    // 비고정 보스 전체 대상으로 계산. respawn 없으면 미입력 계산 불가 → 0
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

    const diff = now - lastMs;
    if (diff < respawnMs + OVERDUE_GRACE_MS) return 0;

    const overdueStart = lastMs + respawnMs + OVERDUE_GRACE_MS;
    const missed = 1 + Math.floor((now - overdueStart) / respawnMs);
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
      const holdUntil = now + OVERDUE_GRACE_MS; // 앞으로 10분 유지
      stateMap.set(b.id, { dueAt, holdUntil });
      // 경과시간을 음수로 리턴 (절댓값이 계속 커짐)
      return -(now - dueAt);
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

  // 보스 초기화(+5분) + ‘이력 전무’ 1회 멍
  async function runInitCutForAll() {
    if (initBusy) return;
    const baseMs = parseTodayHHMM(initTime);
    if (!baseMs) { alert("시간 형식은 HH:mm 입니다. 예) 07:30"); return; }

    const cutAtIso = new Date(baseMs + 5 * 60 * 1000).toString();
    const normals: BossDto[] = [...trackedRaw, ...forgottenRaw];
    const seen = new Set<string>();
    const bosses = normals.filter(b => (seen.has(b.id) ? false : (seen.add(b.id), true)));
    if (bosses.length === 0) { alert("초기화할 보스가 없습니다."); return; }

    if (!confirm(`모든 보스를 오늘 ${initTime} + 5분(${new Date(cutAtIso).toLocaleString()})으로 컷 처리합니다.\n'이력 전무' 보스는 1회 멍까지 자동 처리합니다.`)) return;

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
      alert("보스 시간 초기화 완료!");
      await loadBosses();
      await loadRecentHistory();
      clearSearch();
      setInitOpen(false);
    } finally {
      setInitBusy(false);
    }
  }

  // ──────────────── 공통 도우미 ────────────────
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

  function LocationHover({
    text, bossId, hoverBossId, setHoverBossId,
  }: { text?: string | null; bossId: string; hoverBossId: string | null; setHoverBossId: (id: string | null) => void; }) {
    const open = hoverBossId === bossId;
    const btnRef = useRef<HTMLButtonElement | null>(null);
    const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
    const handleButtonMouseEnter = useCallback(() => setHoverBossId(bossId), [setHoverBossId, bossId]);
    const handleButtonMouseLeave = useCallback(() => setHoverBossId(null), [setHoverBossId]);
    const handleTooltipMouseEnter = useCallback(() => setHoverBossId(bossId), [setHoverBossId, bossId]);
    const handleTooltipMouseLeave = useCallback(() => setHoverBossId(null), [setHoverBossId]);

    useEffect(() => {
      if (!open) { setTooltipPos(null); return; }
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
    }, [open]);

    const tooltipNode =
      open && !!text && tooltipPos
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

  function renderTileAll(b: BossDto) {
    const remain = remainingMsFor(b);
    const hms = fmtHMS(remain);
    const now = Date.now();
    const silenced = isSilenced(b.id, now);            // ⬅️ 추가
    const isSoon = remain > 0 && remain <= HIGHLIGHT_MS;                 // 5분 이내
    const overdueKeep = remain < 0 && remain >= -OVERDUE_GRACE_MS;       // 지남~10분 유예
    const shouldBlink = !silenced && (isSoon || overdueKeep);
    const blinkCls = shouldBlink
      ? "animate-blink border-2 border-rose-500 bg-rose-50"
      : "border border-slate-200 bg-white";

    const canDaze = !!b.isRandom;
    const dazeCount = Number((b as any)?.dazeCount ?? 0);
    const missCount = computeEffectiveMiss(b);

    const afterLabel = remain < 0 ? (Math.abs(remain) <= OVERDUE_GRACE_MS ? "지남" : "지남") : "뒤 예상";

    return (
      <div key={b.id} className={`relative overflow-visible z-[40] hover:z-[90] rounded-xl shadow-sm p-3 text-sm ${blinkCls}`}>
        {/* 미입력/멍 배지 — 우상단 겹치기 */}
        {((missCount > 0) || (dazeCount > 0)) && (
          <div className="absolute top-0 right-0 translate-x-1/4 -translate-y-1/4 inline-flex flex-row flex-nowrap whitespace-nowrap items-center gap-2 pointer-events-none z-[95] scale-75">
            {missCount > 0 && (
              <span className="rounded-[8px] border border-sky-300 bg-sky-50/95 px-2 py-0.5 text-[11px] font-semibold text-sky-700 shadow-md">
                미입력 {missCount}
              </span>
            )}
            {dazeCount > 0 && (
              <span className="rounded-[6px] border border-amber-300 bg-amber-50/90 px-1.5 py-[1px] text-[10px] font-medium text-amber-700 shadow">
                멍 {dazeCount}
              </span>
            )}
          </div>
        )}

        <div className="font-medium text-[13px] whitespace-nowrap overflow-visible">{b.name}</div>
        <div className="text-xs text-slate-600 whitespace-nowrap">
          {hms == null ? "미입력" : (<>{hms}<span className="ml-1">{afterLabel}</span></>)}
        </div>

        <div className="mt-1 grid grid-cols-2 gap-1 items-center">
          {b.isRandom ? (
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
                <LocationHover text={b.location} bossId={b.id} hoverBossId={hoverBossId} setHoverBossId={setHoverBossId} />
              </div>
            </div>
          )}
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
        if (remain <= th && !(prev?.has(th))) toSpeak.push({ id: f.id, name: f.name, threshold: th });
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

  /** 간편 컷 */
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
      const [h, m] = timeRaw.split(":"); hh = parseInt(h, 10); mm = parseInt(m, 10);
    } else { return null; }
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
      // 저장
      await postJSON(`/v1/dashboard/bosses/${parsed.boss.id}/cut`, {
        cutAtIso: parsed.iso,
        mode: "TREASURY",
        items: [],
        participants: [],
      });

      // ⬇️ 간편컷 성공 직후: 지남 유지/알림 상태 정리 + 10분 억제 ON
      const id = parsed.boss.id;
      overdueStateRef.current.delete(id); // 0분 0초 카운트업(지남 유지) 즉시 해제
      missedWarnSetRef.current.delete(id); // "미입력 이동" 경고 상태 제거
      setAlertedMap((prev) => {            // 5/1분 음성 알림 임계값 기록 초기화
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      actionSilenceRef.current.set(id, Date.now() + ACTION_SILENCE_MS); // 10분간 깜빡임/상단고정 억제

      // UI 갱신
      setQuickCutText("");
      await loadBosses();
      await loadRecentHistory();
      clearSearch();
      onForceRefresh?.();
    } catch (e: any) {
      alert(e?.message ?? "간편컷 저장 실패");
    } finally {
      setQuickSaving(false);
    }
  }

  // 즉시 컷
  async function instantCut(b: BossDto) {
    try {
      await postJSON(`/v1/dashboard/bosses/${b.id}/cut`, { cutAtIso: new Date().toString(), mode: "TREASURY", items: [], participants: [] });

      // ⬇️ 추가: 지남 유지/경고 상태 해제 + 10분 억제 ON
      overdueStateRef.current.delete(b.id);
      missedWarnSetRef.current.delete(b.id);
      setAlertedMap(prev => { const next = new Map(prev); next.delete(b.id); return next; });
      actionSilenceRef.current.set(b.id, Date.now() + ACTION_SILENCE_MS);

      await loadBosses();
      await loadRecentHistory();
      clearSearch();
      onForceRefresh?.();
    } catch (e: any) { alert(e?.message ?? "즉시 컷 실패"); }
  }

  // 멍
  async function addDaze(b: BossDto) {
    try {
      // 최근 컷 타임라인 조회
      const tl = await getTimelineIdForBossName(b.name);
      if (!tl?.id) {
        alert("해당 보스의 최근 컷 타임라인을 찾을 수 없습니다.");
        return;
      }

      // 멍 기록
      await postJSON(`/v1/boss-timelines/${tl.id}/daze`, { atIso: new Date().toString() });

      // ⬇️ 컷/멍 직후 처리: 지남 유지/알림 상태 정리 + 10분 억제 ON
      overdueStateRef.current.delete(b.id);                 // 0분 0초 카운트업(지남 유지) 즉시 해제
      missedWarnSetRef.current.delete(b.id);                // "미입력 이동" 음성 경고 재발 방지 잔여 상태 제거
      setAlertedMap((prev) => {                             // 5/1분 알림 임계값 기록 초기화
        const next = new Map(prev);
        next.delete(b.id);
        return next;
      });
      actionSilenceRef.current.set(b.id, Date.now() + ACTION_SILENCE_MS); // 10분간 깜빡임/상단고정 억제

      // 최신 데이터 반영
      await loadBosses();
      await loadRecentHistory();
      clearSearch();
      onForceRefresh?.();
    } catch (e: any) {
      alert(e?.message ?? "멍 기록에 실패했습니다. 잠시 후 다시 시도해 주세요.");
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
          <h2 className="text-base font-semibold mb-2 text-slate-700">
            보스타임 관리
            {query && (
              <span className="ml-2 text-xs text-slate-400">
                ({normalsAll.length}개)
              </span>
            )}
          </h2>

      {/* ── 상단 컨트롤 바: 검색 / 음성 on/off / 간편컷 / 보스 초기화 / 디코 공유·가져오기 ── */}
      <div className="sticky top-0 z-[60] bg-white/85 backdrop-blur px-2 py-2 rounded-md border">
        <div className="flex items-center gap-3 flex-wrap">
          {/* 검색 */}
          <div className="relative w-auto min-w-[160px] max-w-[220px]">
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
          <div className="h-6 border-l mx-1.5" />

          {/* 음성 알림 on/off */}
          <label className="flex items-center gap-2 text-sm select-none">
            <input
              type="checkbox"
              checked={voiceEnabled}
              onChange={(e) => setVoiceEnabled(e.currentTarget.checked)}
            />
            음성 알림
          </label>

          {/* 칸막이 */}
          <div className="h-6 border-l mx-1.5" />

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
          <div className="h-6 border-l mx-1.5" />

          {/* 보스 초기화 (모달 열기) */}
          <button
            type="button"
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-900 text-white text-sm hover:opacity-90"
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
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-900 text-white text-sm hover:opacity-90"
            onClick={openShareModal}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 12v.01M4 6v.01M4 18v.01M12 6v12m0 0l-4-4m4 4l4-4" />
            </svg>
            디코 보스봇 시간 공유
          </button>

          {/* 디코 보스봇 시간 가져오기 (모달 열기) */}
          <button
            type="button"
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-900 text-white text-sm hover:opacity-90"
            onClick={() => setImportOpen(true)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M20 12v.01M20 6v.01M20 18v.01M12 18V6m0 0l-4 4m4-4l4 4" />
            </svg>
            디코 보스봇 시간 가져오기
          </button>
        </div>
      </div>

          {loading ? (
            <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-500">
              불러오는 중…
            </div>
          ) : normalsAll.length === 0 ? (
            <div className="mt-3 h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-400 italic">
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
            </div>
          )}
        </section>

        {/* 우측: 잡은 보스 이력 */}
        <aside className="overflow-y-auto overflow-x-hidden border-l pl-3 pr-4 [scrollbar-gutter:stable_both-edges]">
          <h2 className="text-base font-semibold mb-2 text-slate-700">잡은 보스 이력</h2>

          {/* 기간 표시(텍스트) + 달력 버튼: 한 줄 */}
          <div className="mb-2 sticky top-0 z-10 bg-white/90 backdrop-blur px-1 py-1 rounded">
            <div className="flex items-center gap-2 text-[11px] text-slate-600">
              <span className="px-1 py-[2px] rounded bg-slate-50 border text-slate-700">{recentFromDate}</span>
              <button
                type="button"
                className="ml-1 inline-flex items-center gap-1 px-2 py-[4px] rounded border hover:bg-slate-50"
                title="From 날짜 변경"
                onClick={() => {
                  const el = recentFromRef.current;
                  if (!el) return;
                  (el as any).showPicker?.() ?? el.focus();
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeWidth="2" d="M8 2v3M16 2v3M3 8h18M5 12h14M5 16h10" />
                </svg>
              </button>
              <span className="shrink-0">~</span>
              <span className="px-1 py-[2px] rounded bg-slate-50 border text-slate-700">{recentToDate}</span>

              {/* To 버튼 + 투명 date input(앵커) */}
              <div className="relative">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 px-2 py-[4px] rounded border hover:bg-slate-50"
                  title="To 날짜 변경"
                  onClick={() => {
                    const el = recentToRef.current;
                    if (!el) return;
                    (el as any).showPicker?.() ?? el.focus();
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
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
                  // ✅ 'from'은 선택 가능한 최소/최대 범위를 'to' 기준 31일로 제한
                  min={addDaysStr(recentToDate, -30)}
                  max={recentToDate}
                  onChange={(e) => {
                    const nextFrom = e.currentTarget.value;
                    if (!nextFrom) return;
                    if (daysBetweenInclusive(nextFrom, recentToDate) > 31) {
                      alert("검색 기간은 최대 31일까지만 가능합니다.");
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
                  // ✅ 'to'는 'from' 기준 31일을 넘지 못하도록 제한
                  min={recentFromDate}
                  max={addDaysStr(recentFromDate, 30)}
                  onChange={(e) => {
                    const nextTo = e.currentTarget.value;
                    if (!nextTo) return;
                    if (daysBetweenInclusive(recentFromDate, nextTo) > 31) {
                      alert("검색 기간은 최대 31일까지만 가능합니다.");
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
            <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-500">
              불러오는 중…
            </div>
          ) : recentList.length === 0 ? (
            <div className="mt-3 h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-400 italic">
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
                if (tone === "warning") return "px-2 py-[6px] text-[12px] rounded-md bg-orange-500 text-white hover:opacity-90";
                if (tone === "success") return "px-2 py-[6px] text-[12px] rounded-md bg-emerald-500 text-white";
                return "px-2 py-[6px] text-[12px] rounded-md border hover:bg-slate-50";
              };

              const Item = ({r, act}: { r: RecentTimelineRow; act: ReturnType<typeof calcAction> }) => (
                <li key={`${r.id}-${r.cutAt}`} className="rounded-lg border bg-white px-3 py-2 text-sm shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium truncate">{r.bossName}</div>
                    <div className="text-[11px] text-slate-500 whitespace-nowrap">
                      {fmtTimeHM(r.cutAt)}
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <div className="text-[11px] text-slate-500">{new Date(r.cutAt).toLocaleString()}</div>
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
                      <div className="mb-1 text-[11px] text-orange-600 font-semibold">처리 필요</div>
                      <ul className="space-y-2">
                        {needAction.map(x => <Item key={x.row.id + x.row.cutAt} r={x.row} act={x.action} />)}
                      </ul>
                      <div className="my-2 border-t" />
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
      <div className="flex-[1.6] min-h-0 border-t mt-3 pt-2 overflow-x-auto">
        <h2 className="text-base font-semibold mb-2 text-slate-700">
          고정 보스
        </h2>
        {loading ? (
          <div className="h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-500">
            불러오는 중…
          </div>
        ) : fixedSorted.length === 0 ? (
          <div className="mt-3 h-12 rounded-xl border shadow-sm flex items-center px-3 text-sm text-slate-400 italic">
            고정 보스가 없습니다.
          </div>
        ) : (
          <div className="flex gap-3 pb-3">
            {fixedSorted.map((fb) => {
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
                ? "relative shrink-0 w-[220px] rounded-xl border shadow-sm p-3 text-sm ring-2 ring-rose-400 bg-rose-50/60 animate-blink"
                : isBlue
                ? "relative shrink-0 w-[220px] rounded-xl border shadow-sm p-3 text-sm ring-2 ring-sky-300 bg-sky-50/60"
                : "relative shrink-0 w-[220px] rounded-xl border shadow-sm p-3 text-sm bg-white";

              const showCountdown = remain > 0 && remain <= HIGHLIGHT_MS;
              return (
                <div key={fb.id} className={wrapClass}>
                  {showCountdown && (
                    <span className="pointer-events-none absolute right-2 bottom-2 z-20 text-[11px] px-2 py-0.5 rounded-md border bg-white/90 backdrop-blur-sm shadow-sm">
                      {fmtMMSS2(remain)} 남음
                    </span>
                  )}
                  <div className="flex items-center justify-between">
                    <div className="font-medium truncate">{fb.name}</div>
                    <div className="text-xs text-slate-500 ml-2 truncate max-w-[110px]">
                      {fb.location}
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-slate-600">
                    젠 시각:{" "}
                    <span className="font-semibold">
                      {(() => {
                        const ns = (fb as any).nextSpawnAt as
                          | string
                          | null
                          | undefined;
                        if (ns) {
                          const t = new Date(ns).getTime();
                          return fmtTimeHM(
                            Number.isFinite(t) ? t : null
                          ) ?? "—";
                        }
                        if (fb.genTime != null) return fmtDaily(fb.genTime);
                        return "—";
                      })()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

            {/* ── 보스 시간 초기화 모달 ── */}
      {initOpen && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center"
          aria-modal="true"
          role="dialog"
          onKeyDown={(e) => {
            if (e.key === "Escape") setInitOpen(false);
          }}
        >
          <div className="absolute inset-0 bg-black/50" onClick={() => setInitOpen(false)} />
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
              입력한 시간의 <b>+ 5분</b>으로 오늘 날짜에 모든 보스를 컷합니다.<br />
              <b>컷/멍 이력이 없던 보스</b>는 이번 1회에 한해 자동으로 멍 처리합니다.
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

            <div className="mt-3 text-[11px] text-slate-500">예) 07:30 → 오늘 07:35로 일괄 컷</div>
          </div>
        </div>
      )}

      {/* ── 디코 보스탐 가져오기 모달 ── */}
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
              <button className="px-3 py-2 rounded-xl border hover:bg-slate-100" onClick={() => setImportOpen(false)}>
                취소
              </button>
              <button
                className="px-3 py-2 rounded-xl bg-slate-900 text-white hover:opacity-90"
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
          </div>
        </div>
      )}

      {/* ── 디코 보스탐 공유 모달 ── */}
      {shareOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center" aria-modal="true" role="dialog">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShareOpen(false)} />
          <div className="relative z-[1001] w-[90vw] max-w-[520px] rounded-2xl bg-white shadow-xl border p-4 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-semibold">디코 보스탐 공유</h3>
              <button type="button" className="px-2 py-1 rounded hover:bg-slate-100" onClick={() => setShareOpen(false)}>×</button>
            </div>

            <textarea className="flex-1 w-full border rounded p-2 text-sm font-mono resize-none" rows={15} readOnly value={shareText} />

            <div className="flex justify-end gap-2 mt-3">
              <button
                type="button"
                className="px-3 py-2 rounded-xl bg-slate-900 text-white hover:opacity-90"
                onClick={() => {
                  navigator.clipboard.writeText(shareText).then(() => alert("복사 완료!"));
                }}
              >
                복사
              </button>
              <button type="button" className="px-3 py-2 rounded-xl border hover:bg-slate-100" onClick={() => setShareOpen(false)}>
                닫기
              </button>
            </div>
          </div>
        </div>
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
    </div>
  );
}