import { useState, useEffect, useMemo, useRef } from "react";
import { postJSON } from "@/lib/http";
import BossCard from "./BossCard";
import type { BossDto, ListBossesResp } from "../../types";

const MS = 1000;
const MIN = 60 * MS;

// 알림 시점들
const ALERT_THRESHOLDS = [5 * MIN, 1 * MIN] as const;
// 임박 하이라이트(5분 이내)
const HIGHLIGHT_MS = 5 * MIN;
// ⬇️ 지남 유예: 5분
const OVERDUE_GRACE_MS = 5 * MIN;
// ⬇️ 지남 경고(음성): 지남 3분째
const MISSED_WARN_MS = 3 * MIN;

// 로컬 스토리지 키
const LS_DAZE = "bossDazeCounts";
const LS_MISS = "bossMissCounts";

type CountMap = Record<string, number>;
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

  const [quickCutText, setQuickCutText] = useState("");
  const [quickSaving, setQuickSaving] = useState(false);

  const [dazeCounts, setDazeCounts] = useState<CountMap>(() => readCounts(LS_DAZE));
  const [missCounts, setMissCounts] = useState<CountMap>(() => readCounts(LS_MISS));

  // 30초 틱
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // ---- Refs ----
  // 서버 nextSpawnAt 사라져도 유지할 마지막 next
  const lastNextSpawnRef = useRef<Map<string, number>>(new Map());
  // 지남 유예 마감 시각 (nextMs + 5분)
  const overdueUntilRef = useRef<Map<string, number>>(new Map());
  // 지남 경고(3분) 1회 발화 여부
  const missedWarnSetRef = useRef<Set<string>>(new Set());
  // “이번 젠” 키(= 지남 시작 ms)를 기록하여 중복 miss 방지
  const lastMissMarkedRef = useRef<Map<string, number>>(new Map());
  // 보스명 → 최근 컷 타임라인 id 캐시(멍 API용)
  const timelineIdCacheRef = useRef<Map<string, string>>(new Map());

  // 기록이 한 번이라도 있었는가? (컷 있거나 멍 찍은 적 있으면 true)
  const hasAnyRecord = (b: BossDto) => {
    const daze = dazeCounts[b.id] ?? 0;
    return !!b.lastCutAt || daze > 0;
  };

  // 보스명 → 최근 컷 타임라인 ID
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
    } catch (e) {
      console.error("타임라인 목록 조회 실패:", e);
      return null;
    }
  }

  // 초기 로드
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

      // ⬇️ 서버 next 갱신 전, 이전 next가 이미 지났다면 유예 고정
      const now = Date.now();
      const prevMap = lastNextSpawnRef.current;
      const nextMap = new Map(prevMap);

      for (const b of data.tracked ?? []) {
        const newMs = b.nextSpawnAt ? new Date(b.nextSpawnAt).getTime() : NaN;
        const prevMs = prevMap.get(b.id);
        // 이전 next가 있고 이미 지났다면(= 지남 이벤트), 유예(5분) 설정 고정
        if (Number.isFinite(prevMs) && now >= prevMs!) {
          const target = prevMs! + OVERDUE_GRACE_MS;
          const existing = overdueUntilRef.current.get(b.id);
          if (!existing || existing < target) {
            overdueUntilRef.current.set(b.id, target);
          }
        }
        if (Number.isFinite(newMs)) nextMap.set(b.id, newMs);
      }
      lastNextSpawnRef.current = nextMap;
    } catch {
      setTrackedRaw([]);
      setForgottenRaw([]);
    } finally {
      setLoading(false);
    }
  }

  // next 계산
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
  }, [trackedRaw, forgottenRaw, tick]);

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

  // 검색
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

  /**
   * 남은/지남 계산 + 유예 마킹(설정만)
   * - 스폰 지남(diff<=0) 시, **유예 마감(overdueUntil = nextMs + 5분)**만 설정/유지
   * - miss +1은 여기서 하지 않음(렌더 중 setState 방지)
   */
  const remainingMsFor = (b: BossDto) => {
    const now = Date.now();
    const nextMs = getNextMsGeneric(b);
    const overdueUntil = overdueUntilRef.current.get(b.id);

    // 유예 중이면 항상 "지남" 취급(파란색 유지)
    if (overdueUntil && now < overdueUntil) {
      const overdueStart = overdueUntil - OVERDUE_GRACE_MS;
      return -(now - overdueStart);
    }
    if (!Number.isFinite(nextMs)) return Number.POSITIVE_INFINITY;

    const diff = nextMs - now;

    if (diff <= 0) {
      // 유예 목표치 설정/업데이트
      const target = nextMs + OVERDUE_GRACE_MS;
      const existing = overdueUntilRef.current.get(b.id);
      if (!existing || existing < target) overdueUntilRef.current.set(b.id, target);

      // 반환값은 "지남 경과 시간"(음수). 유예 중에는 음수로 유지
      const overdueStart = (overdueUntilRef.current.get(b.id) ?? target) - OVERDUE_GRACE_MS;
      return -(now - overdueStart);
    }
    return diff;
  };

  /**
   * ⬇️ 유예 종료 처리 (5분 경과 시점에 miss +1 하고 중앙으로 이동)
   * 렌더 중 setState를 하지 않기 위해, 30초 틱으로 한 번에 처리
   */
  useEffect(() => {
    const now = Date.now();
    const toFinalize: string[] = [];
    overdueUntilRef.current.forEach((until, id) => {
      if (now >= until) toFinalize.push(id);
    });
    if (toFinalize.length === 0) return;

    setMissCounts((prev) => {
      const next = { ...prev };
      for (const id of toFinalize) {
        next[id] = (next[id] ?? 0) + 1;
      }
      writeCounts(LS_MISS, next);
      return next;
    });

    // 중복 방지 & 유예 해제
    for (const id of toFinalize) {
      const until = overdueUntilRef.current.get(id) ?? now;
      const startKey = until - OVERDUE_GRACE_MS;
      lastMissMarkedRef.current.set(id, startKey);
      overdueUntilRef.current.delete(id);
      missedWarnSetRef.current.delete(id);
    }
  }, [tick]);

  // 음성 알림 & 지남 3분 경고
  const [alertedMap, setAlertedMap] = useState<Map<string, Set<number>>>(new Map());
  useEffect(() => {
    if (!voiceEnabled) return;

    const toSpeak: Array<{ id: string; name: string; threshold: number }> = [];
    const toWarnMissed: Array<{ id: string; name: string }> = [];

    // 5/1분 전 알림
    for (const b of filteredAll) {
      const r = remainingMsFor(b);
      if (!(r > 0)) continue;
      const prev = alertedMap.get(b.id);
      for (const th of ALERT_THRESHOLDS) {
        if (r <= th && !(prev?.has(th))) {
          toSpeak.push({ id: b.id, name: b.name, threshold: th });
        }
      }
    }

    // 지남 3분 경고(유예 중)
    for (const b of filteredAll) {
      const r = remainingMsFor(b); // 음수면 지남
      if (r <= -MISSED_WARN_MS && r > -(MISSED_WARN_MS + 30 * MS)) {
        if (!missedWarnSetRef.current.has(b.id)) {
          toWarnMissed.push({ id: b.id, name: b.name });
        }
      }
    }

    if (toSpeak.length === 0 && toWarnMissed.length === 0) return;

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
          await speakKorean(`컷 이나 멍 처리 하지 않으면 미입력 보스로 이동합니다.`);
        } catch {
          await playBeep(300);
        }
        await delay(120);
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
  }, [filteredAll, tick, voiceEnabled]);

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

  // 간편 컷 입력 파싱
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

  // 간편 컷 저장
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

      // 컷하면 miss/daze 리셋 + 유예 해제
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

      setQuickCutText("");
      await loadBosses();
    } catch (e: any) {
      alert(e?.message ?? "간편컷 저장 실패");
    } finally {
      setQuickSaving(false);
    }
  }

  // 즉시 컷
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
      await loadBosses();
    } catch (e: any) {
      alert(e?.message ?? "즉시 컷 실패");
    }
  }

  // 멍(+1)
  async function addDaze(b: BossDto) {
    console.log("[UI] 멍 클릭:", b.id, b.name);

    const prevDaze = dazeCounts[b.id] ?? 0;
    const prevMiss = missCounts[b.id] ?? 0;

    // 낙관적 반영(이번 젠은 '처리됨'으로 간주 → miss 0)
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

    // 서버 기록: 보스명 → 최근 컷 타임라인 → /v1/boss-timelines/:id/daze
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
      console.log("[API] 멍 +1 성공:", url);
      // 필요 시 동기화
      // await loadBosses();
    } catch (e: any) {
      console.error("[API] 멍 +1 실패:", url, e?.message || e);
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

  // 강조/배지 클래스
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

  // 좌측(진행중): miss == 0 && 기록 있음 (유예 중에도 여기 남아있음)
  const leftTracked = useMemo(() => {
    const now = Date.now();
    const withKey = filteredAll.map((b) => {
      const next = getNextMsGeneric(b);
      const overdueUntil = overdueUntilRef.current.get(b.id);
      const isOverKeep = overdueUntil != null && now < overdueUntil;
      const key = isOverKeep
        ? 0 // 유예 중이면 상단 유지
        : Number.isFinite(next)
        ? Math.max(next - now, 0)
        : Number.POSITIVE_INFINITY;
      return { b, key };
    });

    return withKey
      .filter(({ b }) => (missCounts[b.id] ?? 0) === 0 && hasAnyRecord(b))
      .sort((a, z) => a.key - z.key)
      .map(({ b }) => b);
  }, [filteredAll, missCounts, dazeCounts, tick]);

  // 중앙(미입력): miss > 0 || 기록 없음
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
  }, [filteredAll, missCounts, dazeCounts, tick]);

  // 카드 렌더 (섹션별 카운트 표기 달리)
  const renderLeftCard = (b: BossDto) => {
    const remain = remainingMsFor(b);
    const overdueUntil = overdueUntilRef.current.get(b.id);
    const now = Date.now();
    const isOverdueKeep = !!overdueUntil && now < overdueUntil;
    const minsOver = isOverdueKeep
      ? Math.max(1, Math.ceil((now - (overdueUntil - OVERDUE_GRACE_MS)) / MIN))
      : remain < 0
      ? Math.max(1, Math.ceil(-remain / MIN))
      : 0;
    const soon = remain <= HIGHLIGHT_MS && remain > 0 && !isOverdueKeep;
    const wrapClass = soon ? highlightSoonWrap : isOverdueKeep ? highlightOverWrap : "";

    return (
      <div key={b.id} className={wrapClass}>
        {soon && soonBadge}
        {isOverdueKeep && overBadge(minsOver)}
        <BossCard
          b={b}
          onQuickCut={instantCut}
          onDaze={addDaze}              // 진행중에서는 멍 버튼 O
          showCount="daze"
          dazeCount={dazeCounts[b.id] ?? 0}
        />
      </div>
    );
  };

  const renderMiddleCard = (b: BossDto) => {
    const remain = remainingMsFor(b);
    const overdueUntil = overdueUntilRef.current.get(b.id);
    const now = Date.now();
    const isOverdueKeep = !!overdueUntil && now < overdueUntil;
    const minsOver = isOverdueKeep
      ? Math.max(1, Math.ceil((now - (overdueUntil - OVERDUE_GRACE_MS)) / MIN))
      : remain < 0
      ? Math.max(1, Math.ceil(-remain / MIN))
      : 0;
    const soon = remain <= HIGHLIGHT_MS && remain > 0 && !isOverdueKeep;
    const wrapClass = soon ? highlightSoonWrap : isOverdueKeep ? highlightOverWrap : "";

    return (
      <div key={b.id} className={wrapClass}>
        {soon && soonBadge}
        {isOverdueKeep && overBadge(minsOver)}
        <BossCard
          b={b}
          onQuickCut={instantCut}
          /* onDaze 전달 안함 → 멍 버튼 숨김 */
          showCount="miss"
          missCount={missCounts[b.id] ?? 0}
        />
      </div>
    );
  };

  // JSX
  return (
    <div className="grid grid-rows-[auto_1fr] gap-3 h-[calc(100vh-56px)]">
      {/* 상단바 */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* 검색 */}
        <div className="relative w/full max-w-xl">
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

      {/* 본문 3컬럼 */}
      <div className="grid grid-cols-3 gap-4 min-h-0">
        {/* 좌측: 진행중 */}
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
              leftTracked.map(renderLeftCard)
            )}
          </div>
        </section>

        {/* 중앙: 미입력 */}
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
              middleTracked.map(renderMiddleCard)
            )}
          </div>
        </section>

        {/* 우측: 비워둠 */}
        <section className="col-span-1 h-full px-1">
          <h2 className="text-base font-semibold mb-2 text-slate-700">비워둠</h2>
          <div className="h-full rounded-xl border-dashed border-2 border-slate-200 flex items-center justify-center text-slate-400">
            추후 위젯/요약 영역
          </div>
        </section>
      </div>
    </div>
  );
}
