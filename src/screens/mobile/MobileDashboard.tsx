import React, { useEffect, useMemo, useRef, useState } from "react";
import { postJSON } from "@/lib/http";
import { ensurePushSubscription } from "@/lib/push";
import { useAuth } from "@/contexts/AuthContext";
import type { BossDto } from "../../types";

/** 시간 상수 */
const MS = 1000;
const MIN = 60 * MS;
const HIGHLIGHT_MS = 5 * MIN;
const OVERDUE_GRACE_MS = 10 * MIN;
const ALERT_WIN_MS = 1000;
const WARN_10_MS = 10 * MIN;
const WARN_15_MS = 15 * MIN;
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

  const diff = now - lastMs;
  if (diff < respawnMs + OVERDUE_GRACE_MS) return 0;

  const overdueStart = lastMs + respawnMs + OVERDUE_GRACE_MS;
  const missed = 1 + Math.floor((now - overdueStart) / respawnMs);
  return missed;
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
async function instantCut(b: BossDto, onAfter?: () => void, speak?: (t: string) => void, force = false) {
  try {
    const res = await postJSON<{ ok: boolean; needsConfirm?: boolean; by?: string; action?: string }>(`/v1/dashboard/bosses/${b.id}/cut`, {
      cutAtIso: new Date().toString(),
      mode: "TREASURY",
      items: [],
      participants: [],
      force,
    });
    if (res?.needsConfirm && !force) {
      const ok = window.confirm(`${res.by ?? "다른 유저"}님이 이미 ${res.action ?? "컷"} 처리 했습니다. 덮어 씌우시겠습니까?`);
      if (ok) return await instantCut(b, onAfter, speak, true);
      return;
    }
    try { await speak?.(`${b.name} 컷 처리되었습니다.`); } catch {}
    onAfter?.();
  } catch (e: any) {
    alert(e?.message ?? "즉시 컷 실패");
  }
}

/** 멍 */
async function addDaze(b: BossDto, onAfter?: () => void, speak?: (t: string) => void, clanId?: string | null, force = false) {
  try {
    const fallbackClanId = clanId ?? localStorage.getItem("clanId");
    const res = await postJSON<{ ok: boolean; needsConfirm?: boolean; by?: string; action?: string }>(
      `/v1/dashboard/bosses/${b.id}/daze`,
      { atIso: new Date().toString(), clanId: fallbackClanId ?? undefined, force }
    );
    if (res?.needsConfirm && !force) {
      const ok = window.confirm(`${res.by ?? "다른 유저"}님이 이미 ${res.action ?? "멍"} 처리 했습니다. 덮어 씌우시겠습니까?`);
      if (ok) return await addDaze(b, onAfter, speak, clanId, true);
      return;
    }
    try { await speak?.(`${b.name} 멍 처리되었습니다.`); } catch {}
    onAfter?.();
  } catch {
    alert("멍 기록에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

export default function MobileDashboard() {
  const { user, logout } = useAuth();
  const [bossesTracked, setTracked] = useState<BossDto[]>([]);
  const [bossesForgotten, setForgotten] = useState<BossDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
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
      const n = v == null ? 0.8 : Number(v);
      if (!Number.isFinite(n)) return 0.8;
      return Math.min(1, Math.max(0, n));
    } catch { return 0.8; }
  });
  useEffect(() => {
    try { localStorage.setItem("voiceVolume", String(voiceVolume)); } catch {}
  }, [voiceVolume]);

  const alertedRef = useRef<Set<string>>(new Set());
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
    if (sendAppBridge({ type: "TTS_SPEAK", text })) return true;
    try {
      if ((window as any).AndroidTTS?.speak) {
        (window as any).AndroidTTS.speak(text);
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
      utter.volume = Math.min(1, Math.max(0, voiceVolume));
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

  useEffect(() => {
    load();
    const t1 = setInterval(load, 60_000);
    const t2 = setInterval(() => setTick(x => (x + 1) % 60), 1000); // 1초마다 남은 시간 갱신
    return () => { clearInterval(t1); clearInterval(t2); };
  }, []);

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

  return (
    <div className="h-[100dvh] overflow-y-auto bg-slate-950 text-white text-[clamp(22px,5vw,32px)]">
      <div className="py-5">
        <div className="sticky top-0 z-20 px-[5%] pb-4">
          <div className="rounded-2xl border border-white/10 bg-slate-950/85 backdrop-blur p-4 flex items-center gap-4">
            <button
              type="button"
              className={`px-4 py-2 rounded-xl text-[0.85em] font-semibold border ${voiceEnabled ? "border-emerald-300/60 text-emerald-200 bg-emerald-500/10" : "border-white/20 text-white/60 bg-white/5"}`}
              onClick={() => setVoiceEnabled((v) => !v)}
            >
              {voiceEnabled ? "음성 ON" : "음소거"}
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-xl text-[0.85em] font-semibold border border-white/20 text-white/80 bg-white/5 hover:bg-white/10"
              onClick={() => {
                enqueueSpeak("이 버튼으로 소리를 듣고 음량을 조절해주세요.");
              }}
            >
              음성 테스트
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
        </div>
        {loading ? (
          <div className="px-[5%] py-3 text-[0.9em] text-white/70">불러오는 중…</div>
        ) : sortedAll.length === 0 ? (
          <div className="px-[5%] py-3 text-[0.9em] text-white/60">표시할 보스가 없습니다.</div>
        ) : (
          <ul className="space-y-4 pb-28">
            {sortedAll.map((b) => {
              const nms = remainingMsForMobile(b, Date.now(), overdueStateRef);
              const r = remainLabelFromDiff(nms);
              const isSoon = r.tone === "soon";
              const isWarn10 = r.tone === "warn10";
              const isWarn15 = r.tone === "warn15";
              return (
                <li key={b.id} className="px-[5%]">
                  <div className={`w-full rounded-2xl shadow-sm border ${
                    isSoon
                      ? "ring-2 ring-rose-400 bg-rose-500/10 animate-blink"
                      : isWarn10
                      ? "border-amber-400/80 bg-amber-500/10"
                      : isWarn15
                      ? "border-yellow-300/80 bg-yellow-500/10"
                      : "border-white/15 bg-white/5"
                  } p-4`}>
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-[1.1em]">{b.name}</div>
                      <div className={`text-[0.85em] ${isSoon ? "text-rose-300" : "text-white/70"}`}>{r.text}</div>
                    </div>

                    <div className="mt-1 flex items-center justify-between">
                      <div className="text-[0.85em] text-white/70 truncate">
                        젠 위치: <span className="font-medium text-white/90">{b.location ?? "—"}</span>
                      </div>

                      <div className="flex gap-3">
                        {/* 컷: 검정 버튼 */}
                        <button
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
                          className="px-8 py-2.5 rounded-lg bg-rose-500/80 text-white text-[0.85em] hover:bg-rose-500 active:opacity-80"
                        >
                          컷
                        </button>

                        {/* 멍: 랜덤 보스만 */}
                        {b.isRandom && (
                          <button
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
                            className="px-8 py-2.5 rounded-lg bg-white text-black text-[0.85em] hover:bg-gray-100 active:opacity-80"
                          >
                            멍
                          </button>
                        )}
                      </div>
                    </div>
                    {(Number((b as any).dazeCount ?? 0) > 0 || computeMissCount(b) > 0) && (
                      <div className="mt-2 text-[0.8em] text-white/60">
                        {Number((b as any).dazeCount ?? 0) > 0 && (
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
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 하단 고정 버튼 영역 */}
      <div className="fixed bottom-0 left-0 right-0 z-30">
        <div className="w-full px-[5%] py-4 bg-slate-950/95 backdrop-blur border-t border-white/10">
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
    </div>
  );
}
