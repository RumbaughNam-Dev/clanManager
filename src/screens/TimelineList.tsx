// src/screens/TimelineList.tsx
import { useState, useEffect, useMemo, useRef } from "react";
import PageHeader from "../components/common/PageHeader";
import Card from "../components/common/Card";
import Pill from "../components/common/Pill";
import { postJSON } from "@/lib/http";
import BossCutManageModal from "../components/modals/BossCutManageModal";
import CutModal from "./DashBoard/CutModal";

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
  noGenCount: number;
};

type ListResp = {
  ok: true;
  items: TimelineDto[];
};

type TimelineItem = { id: string; bossName: string; cutAt: string; createdBy: string; imageIds: string[]; noGenCount: number; items: any[]; distributions: any[]; };

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

// 판매/분배 완료 여부 계산 헬퍼
function isAllSold(t: TimelineDto) {
  const items = t.items ?? [];
  return items.length > 0 && items.every(it => it.isSold === true);
}
function isAllPaid(t: TimelineDto) {
  const dists = t.distributions ?? [];
  // 분배 데이터가 아예 없으면 '완료'로 보지 않음
  if (dists.length === 0) return false;
  return dists.every(d => d.isPaid === true);
}
function isTimelineComplete(t: TimelineDto) {
  return isAllSold(t) && isAllPaid(t);
}

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

type Props = { refreshTick?: number };

export default function TimelineList({ refreshTick }: { refreshTick?: number }) {
  const [rows, setRows] = useState<TimelineDto[]>([]);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("ALL");

  // 팝업 상태
  const [manageOpen, setManageOpen] = useState(false);
  const [activeTimelineId, setActiveTimelineId] = useState<string | null>(null);

  // ⬇️ 추가: 입력용(CutModal) 상태
  const [cutOpen, setCutOpen] = useState(false);
  const [cutTimelineId, setCutTimelineId] = useState<string | null>(null);
  const [cutBoss, setCutBoss] = useState<{ id: string; name: string } | null>(null);
  const [cutDefaultAt, setCutDefaultAt] = useState<string>(new Date().toString());

  // AbortController로 중복요청 취소
  const abortRef = useRef<AbortController | null>(null);

  // 추가: 날짜 상태
  // 로컬 yyyy-MM-dd 포맷터
  function formatDateLocal(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // 추가: 날짜 상태
  const today = new Date();
  const defaultTo = formatDateLocal(today); // ✅ 로컬 오늘 날짜
  const defaultFrom = formatDateLocal(new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)); // 7일 전

  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);

  useEffect(() => {
    reload();
  }, [fromDate, toDate]);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await postJSON<ListResp>("/v1/boss-timelines", { fromDate, toDate });

      const sorted = (data.items ?? []).sort((a, b) => {
        const aDone = isTimelineComplete(a);
        const bDone = isTimelineComplete(b);

        // 미완료가 먼저
        if (aDone !== bDone) return aDone ? 1 : -1;

        // 같은 그룹이면 최신순
        return new Date(b.cutAt).getTime() - new Date(a.cutAt).getTime();
      });

      setRows(sorted);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  function isTimelineComplete(timeline: TimelineDto) {
    // 아이템 중 판매 안된 게 있으면 미완료
    if (timeline.items?.some(it => !it.isSold)) return false;

    // 판매는 됐지만 분배 안된 게 있으면 미완료
    if (timeline.distributions?.some(d => !d.isPaid)) return false;

    return true;
  }

  useEffect(() => {
    reload();
    return () => abortRef.current?.abort();
  }, []);

  // 부모 refreshKey가 바뀔 때마다 새로고침
  useEffect(() => {
    reload();
  }, [refreshTick]);

  // 1분마다 새로고침
  useEffect(() => {
    reload();
    const t = setInterval(reload, 60_000);
    return () => clearInterval(t);
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
          return s.kind === "DIST_SALE_BEFORE" || s.kind === "DROP_NONE" || s.kind === "TRE_NONE";
        case "SOLD":
          return s.kind === "DIST_SALE_DONE_UNPAID";
        case "PAID":
          return s.kind === "DIST_PAID";
        case "TREASURY":
          return s.kind === "TRE_NONE" || s.kind === "TRE_PART" || s.kind === "TRE_ALL";
      }
    });

    // 1순위: 정보가 입력(아이템 있음) && 분배 완료되지 않은 건
    const isPriority = (t: TimelineDto) => {
      const hasItems = (t.items?.length ?? 0) > 0;
      const done = isTimelineComplete(t);
      return hasItems && !done;
    };

    // 시간 비교(최신 먼저)
    const byCutDesc = (a: TimelineDto, b: TimelineDto) =>
      new Date(b.cutAt).getTime() - new Date(a.cutAt).getTime();

    return filtered.sort((a, b) => {
      const ra = isPriority(a) ? 0 : 1;
      const rb = isPriority(b) ? 0 : 1;
      if (ra !== rb) return ra - rb;    // 우선순위가 높은 것 먼저
      return byCutDesc(a, b);           // 같은 그룹 내에서는 보스 컷 시간 순(최신 우선)
    });
  }, [rows, q, filter]);

  function handleOpenManage(t: TimelineDto) {
    const noData =
      (t.items?.length ?? 0) === 0 &&
      (t.distributions?.length ?? 0) === 0 &&
      (t.noGenCount ?? 0) === 0;

    if (noData) {
      // 입력 정보가 하나도 없으면 → 입력 팝업(CutModal)만 연다
      setCutBoss({ id: "", name: t.bossName }); // id는 생성에 안 써도 무방
      setCutTimelineId(t.id);                   // 빈 타임라인에 이어서 입력
      setCutDefaultAt(t.cutAt || new Date().toString());
      setCutOpen(true);

      // 관리 팝업은 닫기
      setManageOpen(false);
      setActiveTimelineId(null);
    } else {
      // 데이터가 있으면 → 관리 팝업만 열기
      setActiveTimelineId(t.id);
      setManageOpen(true);

      // 입력 팝업은 닫기
      setCutOpen(false);
      setCutTimelineId(null);
      setCutBoss(null);
    }
  }

// src/screens/TimelineList.tsx

return (
  <div className="h-full flex flex-col">
    <Card className="h-full min-h-0 flex flex-col">
      {/* 검색/필터 바 → 같은 행 */}
      <div className="flex flex-wrap items-center gap-2 mb-3 flex-shrink-0">
        {/* 보스명 검색 */}
        <input
          className="border rounded-lg px-2 py-2 text-sm"
          placeholder="보스명 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        {/* 상태 필터 */}
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

        {/* 오른쪽으로 밀착시키기 → ml-auto */}
        <div className="ml-auto flex items-center gap-2">
          <input
            type="date"
            className="border rounded-lg px-2 py-2 text-sm"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
          <span>~</span>
          <input
            type="date"
            className="border rounded-lg px-2 py-2 text-sm"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
      </div>

      {/* 표 → rows만 스크롤 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="text-left text-xs text-gray-500">
              <th className="py-2">컷 시각</th>
              <th>보스</th>
              <th>기록자</th>
              <th>참여</th>
              <th>드랍 요약</th>
              {/* ▼ 추가 */}
              <th>판매완료</th>
              <th>분배완료</th>
              {/* ▲ 추가 */}
              <th>상태</th>
              <th>액션</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-500">
                  불러오는 중…
                </td>
              </tr>
            ) : tableRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-400 italic">
                  기록이 없습니다.
                </td>
              </tr>
            ) : (
              tableRows.map((t) => {
                const s = calcRow(t);

                // 👉 보스 컷 관리에서 아무 입력도 안 한 경우 (아이템, 루팅자, 참여자, 분배방식 모두 없음)
                const noData =
                  (t.items?.length ?? 0) === 0 &&
                  (t.distributions?.length ?? 0) === 0 &&
                  (t.noGenCount ?? 0) === 0;

                if (noData) {
                  return (
                    <tr key={t.id} className="border-t text-gray-400">
                      <td className="py-2">{fmt(t.cutAt)}</td>
                      <td>{t.bossName}</td>
                      <td>{t.createdBy}</td>
                      <td>-</td> {/* 참여 */}
                      <td>-</td> {/* 드랍 요약 */}
                      <td>-</td> {/* 판매완료 */}
                      <td>-</td> {/* 분배완료 */}
                      <td>
                        <div className="flex gap-3">
                          <button
                            onClick={() => handleOpenManage(t)}
                            className="px-2 py-1 rounded bg-slate-900 text-white text-xs"
                          >
                            보스 컷 관리
                          </button>
                          <button
                            onClick={async () => {
                              if (!confirm("정말 삭제하시겠습니까?")) return;
                              try {
                                await postJSON("/v1/boss-timelines/" + t.id + "/delete");
                                alert("삭제되었습니다.");
                                reload();
                              } catch (e: any) {
                                alert(e?.message ?? "삭제 실패");
                              }
                            }}
                            className="px-2 py-1 rounded bg-red-600 text-white text-xs"
                          >
                            삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }

                // 👉 기존 컷 처리 행 (calcRow 적용)
                return (
                  <tr
                    key={t.id}
                    className={`border-t ${
                      s.kind === "DIST_SALE_DONE_UNPAID" ? "bg-orange-100" : ""
                    }`}
                  >
                    <td className="py-2">{fmt(t.cutAt)}</td>
                    <td>{t.bossName}</td>
                    <td>{t.createdBy}</td>
                    <td>{countParticipants(t)}명</td>
                    <td>{buildDropsSummary(t)}</td>
                    <td>{t.items.every(it => it.isSold) ? "O" : "X"}</td>
                    <td>{s.kind === "DIST_PAID" ? "O" : "X"}</td>
                    <td>
                      <Pill tone={s.tone as any}>{s.label}</Pill>
                    </td>
                    <td>
                      <div className="flex gap-3">
                        <button
                          onClick={() => handleOpenManage(t)}
                          className="px-2 py-1 rounded bg-slate-900 text-white text-xs"
                        >
                          보스 컷 관리
                        </button>
                        <button
                          onClick={async () => {
                            if (!confirm("정말 삭제하시겠습니까?")) return;
                            try {
                              await postJSON("/v1/boss-timelines/" + t.id + "/delete");
                              alert("삭제되었습니다.");
                              reload();
                            } catch (e: any) {
                              alert(e?.message ?? "삭제 실패");
                            }
                          }}
                          className="px-2 py-1 rounded bg-red-600 text-white text-xs"
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>

    {/* 관리 팝업 */}
    <BossCutManageModal
      key={activeTimelineId ?? "none"}
      open={manageOpen}
      timelineId={activeTimelineId}
      onClose={() => {
        setManageOpen(false);
        setActiveTimelineId(null);
      }}
      onSaved={async () => {
        try {
          const data = await postJSON<ListResp>("/v1/boss-timelines", { fromDate, toDate });
          setRows(data.items ?? []);
        } catch {
          // ignore
        }
      }}
    />

    {/* 입력 팝업 (정보가 없을 때만 열림) */}
    <CutModal
      open={cutOpen}
      boss={cutBoss}                      // { id: "", name: t.bossName } 형태
      timelineId={cutTimelineId}          // 빈 타임라인에 이어서 입력
      defaultCutAt={cutDefaultAt}
      onClose={() => {
        setCutOpen(false);
        setCutTimelineId(null);
        setCutBoss(null);
      }}
      onSaved={async () => {
        setCutOpen(false);
        setCutTimelineId(null);
        setCutBoss(null);
        // 저장 후 목록 갱신
        try {
          const data = await postJSON<ListResp>("/v1/boss-timelines", { fromDate, toDate });
          setRows(data.items ?? []);
        } catch {
          // ignore
        }
      }}
    />
  </div>
);
}