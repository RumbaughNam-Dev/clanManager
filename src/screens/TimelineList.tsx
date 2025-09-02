// src/screens/TimelineList.tsx
import { useState, useEffect, useMemo, useRef } from "react";
import PageHeader from "../components/common/PageHeader";
import Card from "../components/common/Card";
import Pill from "../components/common/Pill";
import { getJSON } from "../lib/http";
import BossCutManageModal from "../components/modals/BossCutManageModal";

type LootItemDto = {
  id: string;
  itemName: string;
  isSold: boolean;
  soldPrice?: number | null;
  toTreasury?: boolean;      // (구스키마 호환)
  isTreasury?: boolean;      // (신스키마)
  looterLoginId?: string | null;
};

type DistributionDto = {
  id?: string;
  lootItemId: string | null;
  recipientLoginId: string;
  isPaid: boolean;
  amount?: number | null;
};

type TimelineDto = {
  id: string;
  bossName: string;
  cutAt: string;      // ISO
  createdBy: string;
  items: LootItemDto[];
  distributions?: DistributionDto[];
};

type ListResp = {
  ok: true;
  items: TimelineDto[];
};

type StatusFilter = "ALL" | "NOT_SOLD" | "SOLD" | "PAID" | "TREASURY";

function fmt(dt?: string) {
  if (!dt) return "-";
  const d = new Date(dt);
  if (isNaN(d.getTime())) return dt;
  return d.toLocaleString("ko-KR", { hour12: false });
}

function buildDropsSummary(t: TimelineDto) {
  const items = t.items ?? [];
  if (items.length === 0) return "드랍 없음";
  const names = items.map(it => it.itemName).join(", ");
  const treCnt = items.filter(it => (it.toTreasury ?? it.isTreasury) === true).length;
  return treCnt > 0 ? `${names} · 혈비 귀속 예정 ${treCnt}건` : names;
}

function countParticipants(t: TimelineDto) {
  const set = new Set<string>();
  (t.distributions ?? []).forEach(d => set.add(d.recipientLoginId));
  return set.size;
}

/** 상태 계산 + 색상 톤 결정(복구 규칙) */
type RowTone = "success" | "warning" | "default";
type RowCalc = { label: string; tone: RowTone; kind:
  | "DROP_NONE"
  | "DIST_SALE_BEFORE"
  | "DIST_SALE_DONE_UNPAID"
  | "DIST_PAID"
  | "TRE_NONE"
  | "TRE_PART"
  | "TRE_ALL"
};

/**
 * 규칙 요약
 * - 드랍템 없음 → [회색] "드랍템 없음"
 * - 분배 방식(혈비 아님):
 *    · 판매전 → [노랑] "판매전"
 *    · 판매완료 + 일부/전부 미분배 → [노랑] "판매완료 (분배미완)"
 *    · 전부 분배완료 → [초록] "분배완료"
 * - 혈비귀속(전 아이템이 혈비):
 *    · 하나도 안 팔림 → [회색] "판매준비중 (혈비귀속)"
 *    · 일부만 팔림 → [노랑] "판매중 (혈비귀속)"
 *    · 전부 팔림 → [초록] "판매완료 (혈비귀속)"
 */
function calcRow(t: TimelineDto): RowCalc {
  const items = t.items ?? [];
  if (items.length === 0) {
    return { label: "드랍템 없음", tone: "default", kind: "DROP_NONE" };
  }

  const isTreasury = items.every(it => (it.toTreasury ?? it.isTreasury) === true);

  if (isTreasury) {
    const total = items.length;
    const sold = items.filter(it => it.isSold).length;
    if (sold === 0) {
      return { label: "판매준비중 (혈비귀속)", tone: "default", kind: "TRE_NONE" };
    } else if (sold < total) {
      return { label: "판매중 (혈비귀속)", tone: "warning", kind: "TRE_PART" };
    } else {
      return { label: "판매완료 (혈비귀속)", tone: "success", kind: "TRE_ALL" };
    }
  }

  // ── 분배 방식(혈비 아님) ──
  const allSold = items.length > 0 && items.every(it => it.isSold);
  if (!allSold) {
    return { label: "판매전", tone: "warning", kind: "DIST_SALE_BEFORE" };
  }

  // 판매는 끝났다면, 분배 완료 여부 판단
  const dists = t.distributions ?? [];
  if (dists.length === 0) {
    // 분배 정보가 없으면 분배 미완으로 간주
    return { label: "판매완료 (분배미완)", tone: "warning", kind: "DIST_SALE_DONE_UNPAID" };
  }
  const byItem = new Map<string, DistributionDto[]>();
  for (const d of dists) {
    if (!d.lootItemId) continue;
    const arr = byItem.get(d.lootItemId) ?? [];
    arr.push(d);
    byItem.set(d.lootItemId, arr);
  }
  const everyItemPaid = items
    .filter(it => it.isSold)
    .every(it => {
      const ds = byItem.get(it.id) ?? [];
      if (ds.length === 0) return false;
      return ds.every(x => x.isPaid === true);
    });

  if (everyItemPaid) {
    return { label: "분배완료", tone: "success", kind: "DIST_PAID" };
  }
  return { label: "판매완료 (분배미완)", tone: "warning", kind: "DIST_SALE_DONE_UNPAID" };
}

export default function TimelineList() {
  const [rows, setRows] = useState<TimelineDto[]>([]);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("ALL");

  // 팝업 상태
  const [manageOpen, setManageOpen] = useState(false);
  const [activeTimelineId, setActiveTimelineId] = useState<string | null>(null);

  // AbortController로 중복요청 취소
  const abortRef = useRef<AbortController | null>(null);

  const reload = async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    try {
      const data = await getJSON<ListResp>("/v1/boss-timelines", { signal: ac.signal });
      setRows(data.items ?? []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    return () => abortRef.current?.abort();
  }, []);

  // 필터링/정렬
  const tableRows = useMemo(() => {
    const keyword = q.trim().toLowerCase();

    const filtered = rows.filter(t => {
      if (keyword && !t.bossName.toLowerCase().includes(keyword)) return false;

      const s = calcRow(t);
      switch (filter) {
        case "ALL":
          return true;
        case "NOT_SOLD":
          // 판매전 + 드랍없음도 이 필터에서 보고 싶다면 포함
          return s.kind === "DIST_SALE_BEFORE" || s.kind === "DROP_NONE" || s.kind === "TRE_NONE";
        case "SOLD":
          return s.kind === "DIST_SALE_DONE_UNPAID"; // 명확히 '판매완료(분배미완)'만
        case "PAID":
          return s.kind === "DIST_PAID";
        case "TREASURY":
          return s.kind === "TRE_NONE" || s.kind === "TRE_PART" || s.kind === "TRE_ALL";
      }
    });

    return filtered.sort((a, b) => {
      const ta = new Date(a.cutAt).getTime();
      const tb = new Date(b.cutAt).getTime();
      return tb - ta;
    });
  }, [rows, q, filter]);

  return (
    <div className="space-y-4">
      <PageHeader title="잡은 보스 관리" />

      <Card>
        {/* 검색/필터 바 */}
        <div className="flex flex-wrap gap-2 mb-3">
          <input
            className="border rounded-lg px-2 py-2 text-sm"
            placeholder="보스명 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        <select
            className="border rounded-lg px-2 py-2 text-sm"
            value={filter}
            onChange={(e) => setFilter(e.target.value as StatusFilter)}
          >
            <option value="ALL">상태 전체</option>
            <option value="NOT_SOLD">판매전</option>
            <option value="SOLD">판매완료(분배미완)</option>
            <option value="PAID">분배완료</option>
            <option value="TREASURY">혈비귀속</option>
          </select>
        </div>

        {/* 표 */}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th className="py-2">컷 시각</th>
              <th>보스</th>
              <th>기록자</th>
              <th>참여</th>
              <th>드랍 요약</th>
              <th>상태</th>
              <th>액션</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-500">불러오는 중…</td>
              </tr>
            ) : tableRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-400 italic">기록이 없습니다.</td>
              </tr>
            ) : (
              tableRows.map((t) => {
                const s = calcRow(t);
                return (
                  <tr key={t.id} className="border-t">
                    <td className="py-2">{fmt(t.cutAt)}</td>
                    <td>{t.bossName}</td>
                    <td>{t.createdBy}</td>
                    <td>{countParticipants(t)}명</td>
                    <td>{buildDropsSummary(t)}</td>
                    <td>
                      <Pill tone={s.tone as any}>{s.label}</Pill>
                    </td>
                    <td>
                      <button
                        onClick={() => {
                          setActiveTimelineId(t.id);
                          setManageOpen(true);
                        }}
                        className="px-2 py-1 rounded bg-slate-900 text-white text-xs"
                      >
                        보스 컷 관리
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>

      {/* 관리 팝업 */}
      <BossCutManageModal
        open={manageOpen}
        timelineId={activeTimelineId}
        onClose={() => setManageOpen(false)}
        onSaved={async () => {
          try {
            const data = await getJSON<ListResp>("/v1/boss-timelines");
            setRows(data.items ?? []);
          } catch {
            // ignore
          }
        }}
      />
    </div>
  );
}