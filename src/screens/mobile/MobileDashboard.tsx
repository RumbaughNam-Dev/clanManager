import React, { useEffect, useMemo, useRef, useState } from "react";
import { postJSON } from "@/lib/http";
import { ensurePushSubscription } from "@/lib/push";
import type { BossDto } from "../../types";

/** 시간 상수 */
const MS = 1000;
const MIN = 60 * MS;
const HIGHLIGHT_MS = 5 * MIN;
const OVERDUE_GRACE_MS = 10 * MIN;
const ALERT_WIN_MS = 1000;

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

function remainLabel(ms: number) {
  if (!Number.isFinite(ms)) return { text: "미입력", tone: "normal" as const };
  const diff = ms - Date.now();
  if (diff <= 0 && diff >= -OVERDUE_GRACE_MS) return { text: "지남(유예)", tone: "soon" as const };
  if (diff < -OVERDUE_GRACE_MS) return { text: "지남", tone: "past" as const };
  const m = Math.floor(diff / 60000);
  const s = Math.ceil((diff % 60000) / 1000);
  return { text: `${m}분 ${String(s).padStart(2, "0")}초 뒤 젠`, tone: diff <= HIGHLIGHT_MS ? "soon" as const : "normal" as const };
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
async function instantCut(b: BossDto, onAfter?: () => void) {
  try {
    await postJSON(`/v1/dashboard/bosses/${b.id}/cut`, {
      cutAtIso: new Date().toString(),
      mode: "TREASURY",
      items: [],
      participants: [],
    });
    onAfter?.();
  } catch (e: any) {
    alert(e?.message ?? "즉시 컷 실패");
  }
}

/** 멍 */
async function addDaze(b: BossDto, onAfter?: () => void) {
  try {
    const tlId = await latestTimelineIdForBossName(b.name);
    if (!tlId) {
      alert("해당 보스의 최근 컷 타임라인을 찾을 수 없습니다.");
      return;
    }
    await postJSON(`/v1/boss-timelines/${tlId}/daze`, { atIso: new Date().toString() });
    onAfter?.();
  } catch {
    alert("멍 기록에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

export default function MobileDashboard() {
  const [bossesTracked, setTracked] = useState<BossDto[]>([]);
  const [bossesForgotten, setForgotten] = useState<BossDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

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

  function speakKorean(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
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

  useEffect(() => {
    if (!voiceEnabled) return;
    const bosses = [...bossesTracked, ...bossesForgotten];
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
        alertedRef.current.add(key);
        speakKorean(text).catch(() => {});
      };

      if (diff <= 5 * MIN && diff > 5 * MIN - ALERT_WIN_MS) {
        maybeSpeak("T5", `${b.name} 5분 전입니다.${countSuffix}`);
      }
      if (diff <= 1 * MIN && diff > 1 * MIN - ALERT_WIN_MS) {
        maybeSpeak("T1", `${b.name} 1분 전입니다.${countSuffix}`);
      }
      if (diff <= 0 && diff > -ALERT_WIN_MS) {
        maybeSpeak("T0", `${b.name} 젠 시간입니다.${countSuffix}`);
      }
      if (diff <= -5 * MIN && diff > -5 * MIN - ALERT_WIN_MS) {
        maybeSpeak("T5L", `${b.name} 젠 후 5분이 지났습니다. 미입력 확인해주세요.${countSuffix}`);
      }
    });
  }, [tick, voiceEnabled, voiceVolume, bossesTracked, bossesForgotten]);

  useEffect(() => {
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
    load();
    const t1 = setInterval(load, 60_000);
    const t2 = setInterval(() => setTick(x => (x + 1) % 60), 1000); // 1초마다 남은 시간 갱신
    return () => { clearInterval(t1); clearInterval(t2); };
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
    return dedup.sort((a, b) => nextMsFor(a, now) - nextMsFor(b, now));
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
          <ul className="space-y-4">
            {sortedAll.map((b) => {
              const nms = nextMsFor(b);
              const r = remainLabel(nms);
              const isSoon = r.tone === "soon";
              return (
                <li key={b.id} className="px-[5%]">
                  <div className={`w-full rounded-2xl shadow-sm border ${isSoon ? "ring-2 ring-rose-400 bg-rose-500/10" : "border-white/15 bg-white/5"} p-4`}>
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
                          onClick={() => instantCut(b, undefined)}
                          className="px-8 py-2.5 rounded-lg bg-black text-white text-[0.85em] border border-white/30 hover:bg-white/10 active:opacity-80"
                        >
                          컷
                        </button>

                        {/* 멍: 하양 버튼 */}
                        <button
                          onClick={() => addDaze(b, undefined)}
                          className="px-8 py-2.5 rounded-lg bg-white text-black text-[0.85em] hover:bg-gray-100 active:opacity-80"
                        >
                          멍
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 text-[0.8em] text-white/60">
                      멍 {Number((b as any).dazeCount ?? 0)}회 · 미입력 {computeMissCount(b)}회
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
