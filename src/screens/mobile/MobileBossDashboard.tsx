import { useEffect, useMemo, useState } from "react";
import { postJSON } from "@/lib/http";
import type { BossDto, ListBossesResp } from "@/types";
import MobileCutModal from "@/screens/mobile/MobileCutModal";

const MS = 1000;
const MIN = 60 * MS;

export default function MobileBossDashboard() {
  const [loading, setLoading] = useState(true);
  const [trackedRaw, setTrackedRaw] = useState<BossDto[]>([]);
  const [forgottenRaw, setForgottenRaw] = useState<BossDto[]>([]);

  // 상단 고정 컨트롤
  const [query, setQuery] = useState("");
  const [quickText, setQuickText] = useState("");
  const [quickSaving, setQuickSaving] = useState(false);

  // 컷 모달
  const [cutOpen, setCutOpen] = useState(false);
  const [selectedBoss, setSelectedBoss] = useState<BossDto | null>(null);

  // 최초 로드 + 1분마다 새로고침
  useEffect(() => {
    load();
    const t = setInterval(() => load(), 60_000);
    return () => clearInterval(t);
  }, []);
  async function load() {
    setLoading(true);
    try {
      const data = await postJSON<ListBossesResp>("/v1/dashboard/bosses");
      setTrackedRaw(data.tracked ?? []);
      setForgottenRaw(data.forgotten ?? []);
    } catch {
      setTrackedRaw([]);
      setForgottenRaw([]);
    } finally {
      setLoading(false);
    }
  }

  // 정렬(가까운 젠 먼저)
  const { trackedSorted, forgottenSorted, allBosses } = useMemo(() => {
    const safeMs = (iso?: string | null) => (iso ? new Date(iso).getTime() : Number.POSITIVE_INFINITY);

    const trackedSorted = [...trackedRaw].sort(
      (a, b) => safeMs(a.nextSpawnAt) - safeMs(b.nextSpawnAt)
    );

    const now = Date.now();
    const forgottenWithPred = forgottenRaw.map((b) => {
      if (!b.lastCutAt || !b.respawn || b.respawn <= 0) return { b, predicted: Number.POSITIVE_INFINITY };
      const last = new Date(b.lastCutAt).getTime();
      if (Number.isNaN(last)) return { b, predicted: Number.POSITIVE_INFINITY };
      const step = Math.max(1, Math.round(b.respawn * 60 * 1000));
      const diff = now - last;
      const k = Math.max(1, Math.ceil(diff / step));
      return { b, predicted: last + k * step };
    });
    const forgottenSorted = forgottenWithPred.sort((x, y) => x.predicted - y.predicted).map(({ b }) => b);

    return { trackedSorted, forgottenSorted, allBosses: [...trackedRaw, ...forgottenRaw] };
  }, [trackedRaw, forgottenRaw]);

  // 검색(이름/위치 AND 토큰)
  const { trackedFiltered, forgottenFiltered } = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { trackedFiltered: trackedSorted, forgottenFiltered: forgottenSorted };
    const tokens = q.split(/\s+/g);
    const match = (b: BossDto) => {
      const hay = `${b.name} ${b.location ?? ""}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    };
    return {
      trackedFiltered: trackedSorted.filter(match),
      forgottenFiltered: forgottenSorted.filter(match),
    };
  }, [query, trackedSorted, forgottenSorted]);

  // 간편 컷: "2200 서드" / "22:00 서드" / "930 악마왕"
  function parseQuick(s: string) {
    const txt = s.trim();
    if (!txt) return null;
    const parts = txt.split(/\s+/);
    if (parts.length < 2) return null;

    const timeRaw = parts[0];
    const nameQuery = parts.slice(1).join(" ").toLowerCase();

    let hh = NaN, mm = NaN;
    if (/^\d{3,4}$/.test(timeRaw)) {
      const t = timeRaw.padStart(4, "0");
      hh = parseInt(t.slice(0, 2), 10);
      mm = parseInt(t.slice(2, 4), 10);
    } else if (/^\d{1,2}:\d{2}$/.test(timeRaw)) {
      const [h, m] = timeRaw.split(":");
      hh = parseInt(h, 10); mm = parseInt(m, 10);
    } else {
      return null;
    }
    if (!(hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59)) return null;

    const hay = (b: BossDto) => `${b.name} ${b.location ?? ""}`.toLowerCase();
    const boss = allBosses.find((b) => hay(b).includes(nameQuery)) ?? null;

    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    return { boss, iso: d.toISOString() };
  }

  async function quickSave() {
    if (quickSaving) return;
    const parsed = parseQuick(quickText);
    if (!parsed) {
      alert("형식: 시각 보스명 (예: 2200 서드 / 22:00 서드 / 930 악마왕)");
      return;
    }
    if (!parsed.boss) {
      alert("보스를 찾지 못했습니다. (현재 목록에서 검색됩니다)");
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
      setQuickText("");
      await load();
      alert(`[간편컷] ${parsed.boss.name} · ${new Date(parsed.iso).toLocaleTimeString("ko-KR",{hour12:false})} 저장됨`);
    } catch (e: any) {
      alert(e?.message ?? "간편컷 저장 실패");
    } finally {
      setQuickSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-white">

      {/* 헤더 */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b px-3 py-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="메뉴"
          className="p-2 -ml-1"
          onClick={() => alert("메뉴는 추후 구현")}
        >
          {/* 햄버거 */}
          <div className="w-5 h-[2px] bg-slate-800 mb-1" />
          <div className="w-5 h-[2px] bg-slate-800 mb-1" />
          <div className="w-5 h-[2px] bg-slate-800" />
        </button>
        <div className="text-sm font-semibold">보스 대시보드 (모바일)</div>
        <div className="w-6" />
      </header>

      {/* 상단 고정 컨트롤 바 */}
      <div className="sticky top-[40px] z-30 bg-white/95 backdrop-blur border-b px-3 py-2 space-y-2">
        <input
          className="w-full border rounded-lg px-3 py-2 text-sm"
          placeholder="보스/위치 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex gap-2">
          <input
            className="flex-1 border rounded-lg px-3 py-2 text-sm"
            placeholder="간편 컷: 2200 서드"
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                quickSave();
              }
            }}
          />
          <button
            className={`px-3 py-2 rounded-lg text-white text-sm ${quickSaving ? "bg-gray-300" : "bg-slate-900"}`}
            onClick={quickSave}
            disabled={quickSaving}
          >
            {quickSaving ? "저장…" : "저장"}
          </button>
        </div>
      </div>

      {/* 리스트 */}
      <main className="px-3 pb-6">
        {/* 진행중 */}
        <h2 className="mt-3 mb-2 text-sm font-semibold text-slate-700">진행중</h2>
        {loading ? (
          <div className="text-sm text-slate-500">불러오는 중…</div>
        ) : trackedFiltered.length === 0 ? (
          <div className="text-sm text-slate-400">진행중 보스 없음</div>
        ) : (
          <ul className="space-y-2">
            {trackedFiltered.map((b) => (
              <li
                key={b.id}
                className="rounded-xl border p-3 active:opacity-90"
                onClick={() => {
                  setSelectedBoss(b);
                  setCutOpen(true);
                }}
              >
                <div className="text-[15px] font-semibold">{b.name}</div>
                <div className="text-xs text-slate-500 mt-0.5">{b.location ?? "-"}</div>
                <div className="text-xs text-slate-500 mt-1">
                  다음 젠: {b.nextSpawnAt ? new Date(b.nextSpawnAt).toLocaleString("ko-KR",{hour12:false}) : "-"}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* 잊어버린 */}
        <h2 className="mt-5 mb-2 text-sm font-semibold text-slate-700">잊어버린</h2>
        {loading ? (
          <div className="text-sm text-slate-500">불러오는 중…</div>
        ) : forgottenFiltered.length === 0 ? (
          <div className="text-sm text-slate-400">잊어버린 보스 없음</div>
        ) : (
          <ul className="space-y-2">
            {forgottenFiltered.map((b) => (
              <li
                key={b.id}
                className="rounded-xl border p-3 active:opacity-90"
                onClick={() => {
                  setSelectedBoss(b);
                  setCutOpen(true);
                }}
              >
                <div className="text-[15px] font-semibold">{b.name}</div>
                <div className="text-xs text-slate-500 mt-0.5">{b.location ?? "-"}</div>
                <div className="text-xs text-slate-500 mt-1">
                  마지막 컷: {b.lastCutAt ? new Date(b.lastCutAt).toLocaleString("ko-KR",{hour12:false}) : "-"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>

      {/* 모바일 컷 모달 */}
      <MobileCutModal
        open={cutOpen}
        boss={selectedBoss}
        onClose={() => setCutOpen(false)}
        onSaved={async () => {
          setCutOpen(false);
          setSelectedBoss(null);
          await load();
        }}
      />
    </div>
  );
}