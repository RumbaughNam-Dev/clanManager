import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { postJSON, putJSON } from "@/lib/http";
import { ensurePushSubscription } from "@/lib/push";
import { useAuth } from "@/contexts/AuthContext";
import type { BossDto } from "../../types";
import Modal from "@/components/common/Modal";

const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
const BOT_COMMAND_HELP = [
  "-v 메세지 : 메세지를 음성으로 읽어줍니다.",
  "보탐 초기화 : 현재 시각으로 보스타임을 초기화합니다.",
  "[보스명] 컷 : 입력한 보스를 현재 시각으로 컷 처리합니다.",
  "컷 / ㅋ / z : 현재 목록 최상단 보스를 컷 처리합니다.",
  "[보스명] 멍 : 입력한 보스를 현재 시각으로 멍 처리합니다.",
  "멍 / ㅁ / a : 현재 목록 최상단 보스를 멍 처리합니다.",
].join("\n");

function toChosung(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const idx = Math.floor((code - 0xac00) / 588);
      out += CHO[idx] ?? ch;
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

/** 시간 상수 */
const MS = 1000;
const MIN = 60 * MS;
const HIGHLIGHT_MS = 5 * MIN;
const OVERDUE_GRACE_MS = 10 * MIN;
const ALERT_WIN_MS = 1000;
const WARN_10_MS = 10 * MIN;
const WARN_15_MS = 15 * MIN;
const DAY = 24 * 60 * MIN;
const OVERDUE_STATE_KEY = "overdueStateMap";
const VOICE_DEDUP_KEY = "mobileVoiceDedup";
const VOICE_DEDUP_TTL = 5000;

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

function fmtHMSFromDiff(diffMs: number) {
  const t = Math.max(0, Math.floor(Math.abs(diffMs) / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function remainLabelFromDiff(diff: number) {
  if (!Number.isFinite(diff)) return { text: "미입력", tone: "normal" as const };
  if (diff <= 0) {
    const hms = fmtHMSFromDiff(diff);
    return { text: `${hms} 지남`, tone: diff >= -OVERDUE_GRACE_MS ? "soon" as const : "past" as const };
  }
  const hms = fmtHMSFromDiff(diff);
  if (diff <= HIGHLIGHT_MS) return { text: `${hms} 뒤 젠`, tone: "soon" as const };
  if (diff <= WARN_10_MS) return { text: `${hms} 뒤 젠`, tone: "warn10" as const };
  if (diff <= WARN_15_MS) return { text: `${hms} 뒤 젠`, tone: "warn15" as const };
  return { text: `${hms} 뒤 젠`, tone: "normal" as const };
}

function remainingMsForMobile(
  b: BossDto,
  now = Date.now(),
  stateRef?: React.MutableRefObject<Map<string, { dueAt: number; holdUntil: number }>>
): number {
  const next = nextMsFor(b, now);
  if (!Number.isFinite(next)) return Number.POSITIVE_INFINITY;

  const diff = next - now;
  if (!stateRef) return diff;
  const stateMap = stateRef.current;
  const st = stateMap.get(b.id);

  // 막 지남 or 지남 상태: dueAt 고정하고 10분 유지
  if (diff <= 0) {
    const dueAt = st?.dueAt ?? next;
    const holdUntil = st?.holdUntil ?? (dueAt + OVERDUE_GRACE_MS);
    stateMap.set(b.id, { dueAt, holdUntil });
    if (stateRef) {
      try {
        const obj: Record<string, { dueAt: number; holdUntil: number }> = {};
        stateMap.forEach((v, k) => { obj[k] = v; });
        localStorage.setItem(OVERDUE_STATE_KEY, JSON.stringify(obj));
      } catch {}
    }
    if (now <= holdUntil) {
      return -(now - dueAt);
    }
    stateMap.delete(b.id);
    if (stateRef) {
      try {
        const obj: Record<string, { dueAt: number; holdUntil: number }> = {};
        stateMap.forEach((v, k) => { obj[k] = v; });
        localStorage.setItem(OVERDUE_STATE_KEY, JSON.stringify(obj));
      } catch {}
    }
    const respawnMin = Number(b.respawn ?? 0);
    if (!Number.isFinite(respawnMin) || respawnMin <= 0) return Number.POSITIVE_INFINITY;
    const step = respawnMin * 60 * 1000;
    const k = Math.max(1, Math.ceil((now - dueAt) / step));
    const advancedNext = dueAt + k * step;
    return advancedNext - now;
  }

  // 서버에서 다음 젠이 미래로 밀려도 유지 중이면 카운트업 유지
  if (st && now < st.holdUntil) {
    return -(now - st.dueAt);
  }

  // 유지 종료 후 클린업
  if (st && now >= st.holdUntil) stateMap.delete(b.id);
  return diff;
}

function computeMissCount(b: BossDto, now = Date.now()): number {
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

  const lastMs = new Date(b.lastCutAt).getTime();
  if (!Number.isFinite(lastMs) || now <= lastMs) return 0;

  const overdueMs = now - (lastMs + respawnMs);
  if (overdueMs < OVERDUE_GRACE_MS) return 0;

  const missed = 1 + Math.floor((overdueMs - OVERDUE_GRACE_MS) / respawnMs);
  return missed;
}

function cycleStartMs(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const base = new Date(d);
  base.setSeconds(0, 0);
  if (d.getHours() >= 5) base.setHours(5, 0, 0, 0);
  else { base.setDate(base.getDate() - 1); base.setHours(5, 0, 0, 0); }
  return base.getTime();
}

function fixedOccMs(genTime: number | null | undefined, nowMs = Date.now()) {
  const n = genTime == null ? NaN : Number(genTime);
  if (!Number.isFinite(n)) return Number.POSITIVE_INFINITY;
  const start = cycleStartMs(nowMs);
  const offsetMin = ((Math.floor(n) - 300 + 1440) % 1440);
  return start + offsetMin * MIN;
}

function fixedDisplayRemainMs(f: FixedBossDto, nowMs = Date.now()) {
  const occ = fixedOccMs(f.genTime, nowMs);
  if (!Number.isFinite(occ)) return Number.POSITIVE_INFINITY;
  const nextSpawnMs = f.nextSpawnAt ? new Date(f.nextSpawnAt).getTime() : NaN;
  const baseRemain = Number.isFinite(nextSpawnMs) ? nextSpawnMs - nowMs : occ - nowMs;
  if (baseRemain >= -OVERDUE_GRACE_MS) return baseRemain;
  return occ + DAY - nowMs;
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
async function instantCut(b: BossDto, onAfter?: () => void, speak?: (t: string) => void, force = false, announce = true): Promise<boolean> {
  try {
    const res = await postJSON<{ ok?: boolean; needsConfirm?: boolean; by?: string; action?: string; message?: string }>(`/v1/dashboard/bosses/${b.id}/cut`, {
      cutAtIso: new Date().toString(),
      mode: "TREASURY",
      items: [],
      participants: [],
      force,
    });
    if (res?.needsConfirm && !force) {
      const ok = window.confirm(`${res.by ?? "다른 유저"}님이 이미 ${res.action ?? "컷"} 처리 했습니다. 덮어 씌우시겠습니까?`);
      if (ok) return await instantCut(b, onAfter, speak, true, announce);
      return false;
    }
    if (res?.ok === false) {
      alert(res?.message ?? "즉시 컷 처리에 실패했습니다.");
      return false;
    }
    try { if (announce) await speak?.(`${b.name} 컷 처리되었습니다.`); } catch {}
    onAfter?.();
    return true;
  } catch (e: any) {
    alert(e?.message ?? "즉시 컷 실패");
    return false;
  }
}

/** 멍 */
async function addDaze(b: BossDto, onAfter?: () => void, speak?: (t: string) => void, clanId?: string | null, force = false, announce = true): Promise<boolean> {
  if (computeMissCount(b) > 0) {
    alert("미입력 된 보스는 멍 처리 할 수 없습니다.");
    return false;
  }
  try {
    const fallbackClanId = clanId ?? localStorage.getItem("clanId");
    const res = await postJSON<{ ok?: boolean; needsConfirm?: boolean; by?: string; action?: string; message?: string }>(
      `/v1/dashboard/bosses/${b.id}/daze`,
      { atIso: new Date().toString(), clanId: fallbackClanId ?? undefined, force }
    );
    if (res?.needsConfirm && !force) {
      const ok = window.confirm(`${res.by ?? "다른 유저"}님이 이미 ${res.action ?? "멍"} 처리 했습니다. 덮어 씌우시겠습니까?`);
      if (ok) return await addDaze(b, onAfter, speak, clanId, true, announce);
      return false;
    }
    if (res?.ok === false) {
      alert(res?.message ?? "멍 처리에 실패했습니다.");
      return false;
    }
    try { if (announce) await speak?.(`${b.name} 멍 처리되었습니다.`); } catch {}
    onAfter?.();
    return true;
  } catch {
    alert("멍 기록에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    return false;
  }
}

export default function MobileDashboard() {
  const { user, logout } = useAuth();
  const [bossesTracked, setTracked] = useState<BossDto[]>([]);
  const [bossesForgotten, setForgotten] = useState<BossDto[]>([]);
  const [fixedRaw, setFixedRaw] = useState<FixedBossDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [bossListEditMode, setBossListEditMode] = useState(false);
  const [excludedBossIds, setExcludedBossIds] = useState<Set<string>>(new Set());
  const [bossListSaving, setBossListSaving] = useState(false);
  const [commandText, setCommandText] = useState("");
  const [commandSaving, setCommandSaving] = useState(false);
  const [commandHelpOpen, setCommandHelpOpen] = useState(false);
  const [query, setQuery] = useState("");
  const overdueStateRef = useRef<Map<string, { dueAt: number; holdUntil: number }>>(new Map());
  const persistOverdueState = () => {
    try {
      const obj: Record<string, { dueAt: number; holdUntil: number }> = {};
      overdueStateRef.current.forEach((v, k) => { obj[k] = v; });
      localStorage.setItem(OVERDUE_STATE_KEY, JSON.stringify(obj));
    } catch {}
  };
  const clearOverdueFor = (id: string) => {
    if (overdueStateRef.current.has(id)) {
      overdueStateRef.current.delete(id);
      persistOverdueState();
    }
  };

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
  const effectiveVoiceVolume = Math.max(0, Math.min(1, voiceVolume));

  const alertedRef = useRef<Set<string>>(new Set());
  const fixedAlertedRef = useRef<Map<string, Set<string>>>(new Map());
  const fixedCycleStartRef = useRef<number>(0);
  const normalVoicePrimedRef = useRef(false);
  const fixedVoicePrimedRef = useRef(false);
  const recentSpeakRef = useRef<Map<string, number>>(new Map());
  const speakQueueRef = useRef<Promise<void>>(Promise.resolve());
  const appTtsPendingRef = useRef<{ resolve: () => void; timeoutId: number } | null>(null);
  const lastSpeakRef = useRef<{ text: string; at: number } | null>(null);

  function sendAppBridge(message: Record<string, unknown>): boolean {
    try {
      if ((window as any).AppBridge?.postMessage) {
        (window as any).AppBridge.postMessage(JSON.stringify(message));
        return true;
      }
      if ((window as any).webkit?.messageHandlers?.AppBridge?.postMessage) {
        (window as any).webkit.messageHandlers.AppBridge.postMessage(message);
        return true;
      }
    } catch {}
    return false;
  }

  function speakViaApp(text: string): boolean {
    if (sendAppBridge({ type: "TTS_SPEAK", text, volume: effectiveVoiceVolume })) return true;
    try {
      if ((window as any).AndroidTTS?.speak) {
        (window as any).AndroidTTS.speak(text, effectiveVoiceVolume);
        return true;
      }
    } catch {}
    return false;
  }

  function hasAppTtsBridge() {
    return !!((window as any).AppBridge?.postMessage || (window as any).webkit?.messageHandlers?.AppBridge?.postMessage || (window as any).AndroidTTS?.speak);
  }

  function requestPiP() {
    if (sendAppBridge({ type: "ENTER_PIP" })) return;
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    if (isIOS) {
      alert("아이폰에서는 지원하지 않습니다.");
      return;
    }
    alert("안드로이드 기기에서만 사용할 수 있습니다.");
  }

  function speakKorean(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const last = lastSpeakRef.current;
      const now = Date.now();
      if (last && last.text === text && now - last.at < 1200) {
        resolve();
        return;
      }
      lastSpeakRef.current = { text, at: now };

      const hasBridge = hasAppTtsBridge();
      if (speakViaApp(text)) {
        if (appTtsPendingRef.current?.timeoutId) {
          clearTimeout(appTtsPendingRef.current.timeoutId);
        }
        const timeoutMs = Math.min(12000, Math.max(2500, text.length * 120));
        const timeoutId = window.setTimeout(() => {
          appTtsPendingRef.current = null;
          resolve();
        }, timeoutMs);
        appTtsPendingRef.current = { resolve, timeoutId };
        return;
      }
      if (hasBridge) {
        // 브릿지 환경인데 전송 실패 시, 웹 TTS로 중복 재생하지 않음
        resolve();
        return;
      }
      const ss: SpeechSynthesis | undefined = (window as any).speechSynthesis;
      if (!ss || typeof window === "undefined") return reject(new Error("speechSynthesis not available"));
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "ko-KR"; utter.rate = 1; utter.pitch = 1;
      utter.volume = effectiveVoiceVolume;
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

  function enqueueSpeak(text: string) {
    const job = speakQueueRef.current.then(() => speakKorean(text));
    speakQueueRef.current = job.catch(() => {});
    return job;
  }

  function shouldSpeak(key: string) {
    const now = Date.now();
    const last = recentSpeakRef.current.get(key);
    if (last && now - last < VOICE_DEDUP_TTL) return false;
    recentSpeakRef.current.set(key, now);
    try {
      const obj: Record<string, number> = {};
      recentSpeakRef.current.forEach((v, k) => {
        if (now - v < VOICE_DEDUP_TTL * 2) obj[k] = v;
      });
      sessionStorage.setItem(VOICE_DEDUP_KEY, JSON.stringify(obj));
    } catch {}
    return true;
  }

  useEffect(() => {
    if (normalVoicePrimedRef.current) return;
    const bosses = [...bossesTracked, ...bossesForgotten].filter((b, i, arr) =>
      arr.findIndex((x) => x.id === b.id) === i
    );
    if (bosses.length === 0) return;
    const now = Date.now();
    for (const b of bosses) {
      const dueAt = nextMsFor(b, now);
      if (!Number.isFinite(dueAt)) continue;
      const diff = dueAt - now;
      if (diff <= 5 * MIN) alertedRef.current.add(`${b.id}:${dueAt}:T5`);
      if (diff <= 1 * MIN) alertedRef.current.add(`${b.id}:${dueAt}:T1`);
      if (diff <= 0) alertedRef.current.add(`${b.id}:${dueAt}:T0`);
      if (diff <= -5 * MIN) alertedRef.current.add(`${b.id}:${dueAt}:T5L`);
    }
    normalVoicePrimedRef.current = true;
  }, [bossesTracked, bossesForgotten]);

  useEffect(() => {
    if (!voiceEnabled) return;
    const bosses = [...bossesTracked, ...bossesForgotten].filter((b, i, arr) =>
      arr.findIndex((x) => x.id === b.id) === i
    );
    const now = Date.now();
    bosses.forEach((b) => {
      const dueAt = nextMsFor(b, now);
      if (!Number.isFinite(dueAt)) return;
      const diff = dueAt - now;
      const missCount = computeMissCount(b, now);
      const dazeCount = Number((b as any).dazeCount ?? 0);
      const countSuffix =
        missCount > 0 || dazeCount > 0
          ? ` (멍 ${dazeCount}회, 미입력 ${missCount}회)`
          : "";

      const makeKey = (tag: string) => `${b.id}:${dueAt}:${tag}`;
      const maybeSpeak = (tag: string, text: string) => {
        const key = makeKey(tag);
        if (alertedRef.current.has(key)) return;
        if (!shouldSpeak(key)) return;
        alertedRef.current.add(key);
        enqueueSpeak(text);
      };

      if (diff <= 5 * MIN) {
        maybeSpeak("T5", `${b.name} 5분 전입니다.${countSuffix}`);
      }
      if (diff <= 1 * MIN) {
        maybeSpeak("T1", `${b.name} 1분 전입니다.${countSuffix}`);
      }
      if (diff <= 0) {
        maybeSpeak("T0", `${b.name} 젠 시간입니다.${countSuffix}`);
      }
      if (diff <= -5 * MIN) {
        const tail = missCount > 0 ? " 미입력 확인해주세요." : "";
        maybeSpeak("T5L", `${b.name} 젠 후 5분이 지났습니다.${tail}${countSuffix}`);
      }
    });
  }, [tick, voiceEnabled, voiceVolume, bossesTracked, bossesForgotten]);

  useEffect(() => {
    if (!voiceEnabled || fixedRaw.length === 0 || !fixedVoicePrimedRef.current) return;
    const now = Date.now();
    const curStart = cycleStartMs(now);
    if (fixedCycleStartRef.current !== curStart) {
      fixedAlertedRef.current = new Map();
      fixedCycleStartRef.current = curStart;
    }

    const toSpeak: Array<{ id: string; tag: string; text: string }> = [];
    for (const f of fixedRaw) {
      const occ = fixedOccMs(f.genTime, now);
      if (!Number.isFinite(occ)) continue;
      const remain = occ - now;
      const prev = fixedAlertedRef.current.get(f.id);

      if (remain > 0 && remain <= 5 * MIN && !(prev?.has("T5"))) {
        toSpeak.push({ id: f.id, tag: "T5", text: `${f.name} 보스 젠 5분 전입니다.` });
      }
      if (remain > 0 && remain <= 1 * MIN && !(prev?.has("T1"))) {
        toSpeak.push({ id: f.id, tag: "T1", text: `${f.name} 보스 젠 1분 전입니다.` });
      }
      if (remain <= 0 && remain > -5 * MIN && !(prev?.has("T0"))) {
        toSpeak.push({ id: f.id, tag: "T0", text: `${f.name} 보스 젠 시간입니다.` });
      }
      if (remain <= -5 * MIN && !(prev?.has("T5L"))) {
        toSpeak.push({ id: f.id, tag: "T5L", text: `${f.name} 보스 젠 후 5분이 지났습니다.` });
      }
    }
    if (toSpeak.length === 0) return;

    (async () => {
      for (const x of toSpeak) {
        await enqueueSpeak(x.text);
      }
    })().catch(() => {});

    for (const x of toSpeak) {
      const set = fixedAlertedRef.current.get(x.id) ?? new Set<string>();
      set.add(x.tag);
      fixedAlertedRef.current.set(x.id, set);
    }
  }, [tick, voiceEnabled, fixedRaw]);

  useEffect(() => {
    if (fixedVoicePrimedRef.current || fixedRaw.length === 0) return;
    const now = Date.now();
    const seeded = new Map<string, Set<string>>();
    for (const f of fixedRaw) {
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
    fixedAlertedRef.current = seeded;
    fixedCycleStartRef.current = cycleStartMs(now);
    fixedVoicePrimedRef.current = true;
  }, [fixedRaw]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(VOICE_DEDUP_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, number>;
      const now = Date.now();
      const map = new Map<string, number>();
      Object.entries(parsed).forEach(([k, v]) => {
        if (typeof v === "number" && now - v < VOICE_DEDUP_TTL * 2) map.set(k, v);
      });
      recentSpeakRef.current = map;
    } catch {}
  }, []);

  const load = async (forEdit = false) => {
    setLoading(true);
    try {
      const data = await postJSON<any>("/v1/dashboard/bosses", forEdit ? { forEdit: true } : undefined);
      setTracked(data.tracked ?? []);
      setForgotten(data.forgotten ?? []);
      setFixedRaw(((data.fixed ?? []) as any[]).map((f) => ({ ...f, genTime: f.genTime == null ? null : Number(f.genTime) })));
    } catch {
      setTracked([]); setForgotten([]); setFixedRaw([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(bossListEditMode);
    const t1 = setInterval(() => { void load(bossListEditMode); }, 60_000);
    const t2 = setInterval(() => setTick(x => (x + 1) % 60), 1000); // 1초마다 남은 시간 갱신
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [bossListEditMode]);

  useEffect(() => {
    const handleAppMessage = (msg: any) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "TTS_RESULT") {
        if (appTtsPendingRef.current?.timeoutId) {
          clearTimeout(appTtsPendingRef.current.timeoutId);
        }
        const resolve = appTtsPendingRef.current?.resolve;
        appTtsPendingRef.current = null;
        if (resolve) resolve();
      }
      if (msg.type === "PIP_RESULT") {
        if (msg.ok === true || msg.success === true) {
          alert("창모드로 전환되었습니다.");
        } else {
          const reason = msg.message || msg.error || "창모드 전환에 실패했습니다.";
          alert(String(reason));
        }
      }
    };
    const prev = (window as any).onAppMessage;
    (window as any).onAppMessage = handleAppMessage;
    const listener = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      handleAppMessage(detail);
    };
    window.addEventListener("AppMessage", listener as EventListener);
    return () => {
      if ((window as any).onAppMessage === handleAppMessage) {
        (window as any).onAppMessage = prev;
      }
      window.removeEventListener("AppMessage", listener as EventListener);
    };
  }, []);

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

  useEffect(() => {
    const askedKey = "pushPermissionAsked";
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      ensurePushSubscription().catch(() => {});
      return;
    }
    if (Notification.permission === "denied") return;

    try {
      const asked = localStorage.getItem(askedKey);
      if (asked === "1") return;
      localStorage.setItem(askedKey, "1");
    } catch {}

    if (confirm("보스 타이밍을 푸시 알림으로 받으시겠습니까?")) {
      Notification.requestPermission().then((perm) => {
        if (perm === "granted") {
          ensurePushSubscription().catch(() => {});
        }
      });
    }
  }, []);

  const sortedAll = useMemo(() => {
    const now = Date.now();
    const merged = [...bossesTracked, ...bossesForgotten];
    const seen = new Set<string>();
    const dedup = merged.filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)));
    return dedup.sort((a, b) => remainingMsForMobile(a, now, overdueStateRef) - remainingMsForMobile(b, now, overdueStateRef));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bossesTracked, bossesForgotten, tick]);

  const filteredAll = useMemo(() => {
    const q = query.trim();
    if (!q) return sortedAll;
    const tokens = q.split(/\s+/g).filter(Boolean);
    return sortedAll.filter((b) => {
      const hay = `${b.name} ${b.location ?? ""}`;
      const hayLower = hay.toLowerCase();
      const hayCho = toChosung(hay);
      return tokens.every((t) => {
        const tLower = t.toLowerCase();
        if (hayLower.includes(tLower)) return true;
        if (isChosungToken(t)) return hayCho.includes(t);
        return false;
      });
    });
  }, [query, sortedAll]);

  const mobileMixedRows = useMemo(() => {
    const now = Date.now();
    const fixedRows = fixedRaw.map((f) => ({
      kind: "fixed" as const,
      id: `fixed-${f.id}`,
      remain: fixedDisplayRemainMs(f, now),
      fixed: f,
    }));
    const normalRows = filteredAll.map((b) => ({
      kind: "normal" as const,
      id: `normal-${b.id}`,
      remain: remainingMsForMobile(b, now, overdueStateRef),
      boss: b,
    }));
    return [...normalRows, ...fixedRows].sort((a, b) => a.remain - b.remain);
  }, [filteredAll, fixedRaw, tick]);

  const findBossByCommandName = useCallback((nameQuery: string): BossDto | null => {
    const q = nameQuery.trim().toLowerCase();
    if (!q) return null;
    const merged = [...bossesTracked, ...bossesForgotten];
    const seen = new Set<string>();
    const dedup = merged.filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)));
    const byExact = dedup.find((b) => b.name.trim().toLowerCase() === q);
    if (byExact) return byExact;
    return dedup.find((b) => `${b.name} ${b.location ?? ""}`.toLowerCase().includes(q)) ?? null;
  }, [bossesTracked, bossesForgotten]);

  const runInitCutAt = useCallback(async (cutAtIso: string, confirmMessage: string, successMessage: string) => {
    const normals: BossDto[] = [...bossesTracked, ...bossesForgotten];
    const seen = new Set<string>();
    const bosses = normals.filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)));
    if (bosses.length === 0) {
      alert("초기화할 보스가 없습니다.");
      return false;
    }
    if (!confirm(confirmMessage)) return false;

    for (const b of bosses) {
      try {
        await postJSON(`/v1/dashboard/bosses/${b.id}/cut`, { cutAtIso, mode: "TREASURY", items: [], participants: [] });
      } catch (e) {
        console.warn("[mobile-init-cut] failed:", b.name, e);
      }
    }
    for (const b of bosses) {
      const wasNoHistory = !b.lastCutAt && Number((b as any)?.dazeCount ?? 0) === 0;
      if (!wasNoHistory) continue;
      try {
        const timelineId = await latestTimelineIdForBossName(b.name);
        if (timelineId) await postJSON(`/v1/boss-timelines/${timelineId}/daze`, { atIso: new Date().toString() });
      } catch (e) {
        console.warn("[mobile-init-daze] failed:", b.name, e);
      }
    }
    alert(successMessage);
    await load();
    return true;
  }, [bossesTracked, bossesForgotten]);

  const executeBotCommand = useCallback(async (rawText: string) => {
    const text = rawText.trim();
    if (!text) return;

    if (text === "명령어") {
      setCommandHelpOpen(true);
      setCommandText("");
      return;
    }

    if (text.startsWith("-v ")) {
      const message = text.slice(3).trim();
      if (!message) {
        alert("읽을 메세지를 입력해주세요.");
        return;
      }
      await speakKorean(message);
      setCommandText("");
      return;
    }

    if (text === "보탐 초기화") {
      const now = new Date();
      const ok = await runInitCutAt(
        now.toString(),
        `모든 보스를 현재 시각(${now.toLocaleString()})으로 컷 처리합니다.\n'이력 전무' 보스는 1회 멍까지 자동 처리합니다.`,
        "보스타임을 현재 시각으로 초기화했습니다."
      );
      if (ok) setCommandText("");
      return;
    }

    const lower = text.toLowerCase();
    const topBoss = sortedAll[0] ?? null;
    const cutAliases = new Set(["컷", "ㅋ", "z"]);
    const dazeAliases = new Set(["멍", "ㅁ", "a"]);

    if (cutAliases.has(lower)) {
      if (!topBoss) {
        alert("처리할 보스가 없습니다.");
        return;
      }
      const ok = await instantCut(
        topBoss,
        async () => {
          clearOverdueFor(topBoss.id);
          await load();
        },
        voiceEnabled ? enqueueSpeak : undefined,
        false,
        false
      );
      if (ok && voiceEnabled) {
        try { await speakKorean(`${topBoss.name} 컷 처리되었습니다.`); } catch {}
      }
      if (ok) setCommandText("");
      return;
    }

    if (dazeAliases.has(lower)) {
      if (!topBoss) {
        alert("처리할 보스가 없습니다.");
        return;
      }
      const ok = await addDaze(
        topBoss,
        async () => {
          clearOverdueFor(topBoss.id);
          await load();
        },
        voiceEnabled ? enqueueSpeak : undefined,
        user?.clanId ?? localStorage.getItem("clanId"),
        false,
        false
      );
      if (ok && voiceEnabled) {
        try { await speakKorean(`${topBoss.name} 멍 처리되었습니다.`); } catch {}
      }
      if (ok) setCommandText("");
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
        const ok = await instantCut(
          boss,
          async () => {
            clearOverdueFor(boss.id);
            await load();
          },
          voiceEnabled ? enqueueSpeak : undefined,
          false,
          false
        );
        if (ok && voiceEnabled) {
          try { await speakKorean(`${boss.name} 컷 처리되었습니다.`); } catch {}
        }
        if (ok) setCommandText("");
        return;
      }

      const ok = await addDaze(
        boss,
        async () => {
          clearOverdueFor(boss.id);
          await load();
        },
        voiceEnabled ? enqueueSpeak : undefined,
        user?.clanId ?? localStorage.getItem("clanId"),
        false,
        false
      );
      if (ok && voiceEnabled) {
        try { await speakKorean(`${boss.name} 멍 처리되었습니다.`); } catch {}
      }
      if (ok) setCommandText("");
      return;
    }

    alert("지원 명령어: -v 메세지 / 보탐 초기화 / [보스명] 컷 / [보스명] 멍 / 컷(ㅋ,z) / 멍(ㅁ,a)");
  }, [sortedAll, user?.clanId, voiceEnabled, bossesTracked, bossesForgotten, findBossByCommandName, runInitCutAt]);

  const submitCommand = useCallback(async () => {
    if (commandSaving) return;
    setCommandSaving(true);
    try {
      await executeBotCommand(commandText);
    } catch (e: any) {
      alert(e?.message ?? "명령 실행 실패");
    } finally {
      setCommandSaving(false);
    }
  }, [commandSaving, commandText, executeBotCommand]);

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
        await load(true);
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
      await load();
    } catch (e: any) {
      alert(e?.message ?? "보스 목록 편집 저장 실패");
    } finally {
      setBossListSaving(false);
    }
  }, [bossListEditMode, bossListSaving, excludedBossIds, user?.clanId, user?.id]);

  const cancelBossListEdit = useCallback(() => {
    if (bossListSaving) return;
    setExcludedBossIds(new Set());
    setBossListEditMode(false);
  }, [bossListSaving]);

  return (
    <div className="h-[100dvh] overflow-y-auto bg-slate-950 text-white text-base">
      <div className="py-5">
        <div className="sticky top-0 z-40 px-[5%] pb-4">
          <div className="rounded-2xl border border-white/10 bg-slate-950/85 backdrop-blur p-4">
            <div className="flex items-center gap-4">
              <button
                type="button"
                className={`px-4 py-2 rounded-xl text-[0.85em] font-semibold border ${voiceEnabled ? "border-emerald-300/60 text-emerald-200 bg-emerald-500/10" : "border-white/20 text-white/60 bg-white/5"}`}
                onClick={() => setVoiceEnabled((v) => !v)}
              >
                {voiceEnabled ? "음성 ON" : "음소거"}
              </button>
              <div className="flex-1">
                <div className="text-[0.75em] text-white/60 mb-2">볼륨</div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(voiceVolume * 100)}
                  onChange={(e) => setVoiceVolume(Number(e.currentTarget.value) / 100)}
                  className="w-full"
                />
              </div>
            </div>
            <div className="mt-4">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                placeholder="보스 검색 (초성가능)"
                className="w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-[0.9em] text-white placeholder:text-white/45"
              />
            </div>
          </div>
        </div>
        {loading ? (
          <div className="px-[5%] py-3 text-[0.9em] text-white/70">불러오는 중…</div>
        ) : mobileMixedRows.length === 0 ? (
          <div className="px-[5%] py-3 text-[0.9em] text-white/60">표시할 보스가 없습니다.</div>
        ) : (
          <ul className="space-y-4 pb-28">
            {mobileMixedRows.map((row) => {
              if (row.kind === "fixed") {
                const f = row.fixed;
                const nms = row.remain;
                const r = remainLabelFromDiff(nms);
                const isSoon = r.tone === "soon";
                const isWarn10 = r.tone === "warn10";
                const isWarn15 = r.tone === "warn15";
                return (
                  <li key={row.id} className="px-[5%]">
                    <div className={`relative w-full rounded-2xl shadow-sm border ${
                      isSoon
                        ? "ring-2 ring-rose-400 bg-rose-500/10 animate-blink"
                        : isWarn10
                        ? "border-amber-400/80 bg-amber-500/10"
                        : isWarn15
                        ? "border-yellow-300/80 bg-yellow-500/10"
                        : "border-white/15 bg-white/5"
                    } p-4`}>
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-[1.1em]">{f.name}</div>
                        <div className={`text-[0.85em] ${isSoon ? "text-rose-300" : "text-white/70"}`}>{r.text}</div>
                      </div>

                      <div className="mt-1 flex items-center justify-between">
                        <div className="text-[0.85em] text-white/70 truncate">
                          젠 위치: <span className="font-medium text-white/90">{f.location ?? "—"}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            instantCut(
                              f as unknown as BossDto,
                              async () => {
                                await load();
                              },
                              voiceEnabled ? enqueueSpeak : undefined
                            )
                          }
                          className="px-8 py-2.5 rounded-lg bg-rose-500/80 text-white text-[0.85em] hover:bg-rose-500 active:opacity-80"
                        >
                          컷
                        </button>
                      </div>
                    </div>
                  </li>
                );
              }

              const b = row.boss;
              const isExcludedInEdit = bossListEditMode && excludedBossIds.has(b.id);
              const nms = row.remain;
              const r = remainLabelFromDiff(nms);
              const isSoon = r.tone === "soon";
              const isWarn10 = r.tone === "warn10";
              const isWarn15 = r.tone === "warn15";
              return (
                <li key={row.id} className="px-[5%]">
                  <div className={`relative w-full rounded-2xl shadow-sm border ${
                    !bossListEditMode && isSoon
                      ? "ring-2 ring-rose-400 bg-rose-500/10 animate-blink"
                      : isWarn10
                      ? "border-amber-400/80 bg-amber-500/10"
                      : isWarn15
                      ? "border-yellow-300/80 bg-yellow-500/10"
                      : "border-white/15 bg-white/5"
                  } p-4`}>
                    {bossListEditMode && (
                      <button
                        type="button"
                        onClick={() => toggleExcludedBoss(b.id)}
                        className={`absolute top-3 right-3 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full shadow-sm ${
                          isExcludedInEdit
                            ? "bg-blue-400/80 text-white hover:bg-blue-400"
                            : "bg-rose-400/80 text-white hover:bg-rose-400"
                        }`}
                        aria-label={isExcludedInEdit ? "목록에 다시 추가" : "목록에서 제외"}
                      >
                        {isExcludedInEdit ? (
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                            <path d="M12 6v12" />
                            <path d="M6 12h12" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                            <path d="M7 7l10 10" />
                            <path d="M17 7L7 17" />
                          </svg>
                        )}
                      </button>
                    )}
                    <div className={isExcludedInEdit ? "grayscale opacity-50 blur-[1px]" : ""}>
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-[1.1em]">{b.name}</div>
                        {!bossListEditMode && (
                          <div className={`text-[0.85em] ${isSoon ? "text-rose-300" : "text-white/70"}`}>
                            {r.text}
                          </div>
                        )}
                      </div>

                      <div className="mt-1 flex items-center justify-between">
                        <div className="text-[0.85em] text-white/70 truncate">
                          젠 위치: <span className="font-medium text-white/90">{b.location ?? "—"}</span>
                        </div>

                        <div className="flex gap-3">
                          {/* 컷: 검정 버튼 */}
                          <button
                            type="button"
                            disabled={bossListEditMode}
                            onClick={() =>
                              instantCut(
                                b,
                                async () => {
                                  clearOverdueFor(b.id);
                                  await load();
                                },
                                voiceEnabled ? enqueueSpeak : undefined
                              )
                            }
                            className="px-8 py-2.5 rounded-lg bg-rose-500/80 text-white text-[0.85em] hover:bg-rose-500 active:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            컷
                          </button>

                          {/* 멍: 랜덤 보스만 */}
                          {b.isRandom && (
                            <button
                              type="button"
                              disabled={bossListEditMode}
                              onClick={() =>
                                addDaze(
                                  b,
                                  async () => {
                                    clearOverdueFor(b.id);
                                    await load();
                                  },
                                  voiceEnabled ? enqueueSpeak : undefined,
                                  user?.clanId ?? localStorage.getItem("clanId")
                                )
                              }
                              className="px-8 py-2.5 rounded-lg bg-white text-black text-[0.85em] hover:bg-gray-100 active:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              멍
                            </button>
                          )}
                        </div>
                      </div>
                    {!bossListEditMode && (Number((b as any).dazeCount ?? 0) > 0 || computeMissCount(b) > 0) && (
                      <div className="mt-2 text-[0.8em] text-white/60">
                          {computeMissCount(b) === 0 && Number((b as any).dazeCount ?? 0) > 0 && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-200 border border-amber-300/60 mr-2">
                              멍 {Number((b as any).dazeCount ?? 0)}회
                            </span>
                          )}
                          {computeMissCount(b) > 0 && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-sky-400/20 text-sky-200 border border-sky-300/60">
                              미입력 {computeMissCount(b)}회
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
            <li className="px-[5%]">
              <div
                onClick={() => void handleBossListEditCardClick()}
                className="w-full rounded-2xl shadow-sm border border-white/15 bg-white/5 p-4 cursor-pointer"
              >
                <div className="flex min-h-[92px] items-center justify-center text-center text-[1.05em] font-semibold text-blue-300">
                  {bossListEditMode ? (bossListSaving ? "저장 중..." : "저장") : "보스 목록 편집"}
                </div>
              </div>
            </li>
            {bossListEditMode && (
              <li className="px-[5%]">
                <div
                  onClick={cancelBossListEdit}
                  className="w-full rounded-2xl shadow-sm border border-white/15 bg-white/5 p-4 cursor-pointer"
                >
                  <div className="flex min-h-[92px] items-center justify-center text-center text-[1.05em] font-semibold text-white/80">
                    취소
                  </div>
                </div>
              </li>
            )}
          </ul>
        )}
      </div>

      {/* 하단 고정 버튼 영역 */}
      <div className="fixed bottom-0 left-0 right-0 z-50">
        <div className="w-full px-[5%] py-4 bg-slate-950/95 backdrop-blur border-t border-white/10">
          <div className="mb-3">
            <input
              type="text"
              value={commandText}
              onChange={(e) => setCommandText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if ((e.nativeEvent as KeyboardEvent).isComposing || e.keyCode === 229) return;
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submitCommand();
                }
              }}
              placeholder='보탐봇 명령어 입력 "명령어" 라고 입력하면 명령어 목록이 나옵니다.'
              className="w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-[0.9em] text-white placeholder:text-white/45"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
          <button
            type="button"
            onClick={requestPiP}
            className="py-3 rounded-2xl bg-white/15 text-white font-semibold border border-white/20 hover:bg-white/20"
          >
            창모드
          </button>
          <button
            type="button"
            onClick={() => alert("기능 준비중입니다.")}
            className="py-3 rounded-2xl bg-white/10 text-white/80 border border-white/10 hover:bg-white/15"
          >
            잡은보스관리
          </button>
          <button
            type="button"
            onClick={logout}
            className="py-3 rounded-2xl bg-white/10 text-white/80 border border-white/10 hover:bg-white/15"
          >
            로그아웃
          </button>
          </div>
        </div>
      </div>
      <Modal
        open={commandHelpOpen}
        onClose={() => setCommandHelpOpen(false)}
        title="보탐봇 명령어"
        maxWidth="max-w-[560px]"
      >
        <pre className="whitespace-pre-wrap text-sm leading-7 text-white/85">{BOT_COMMAND_HELP}</pre>
      </Modal>
    </div>
  );
}
