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

  // 두 날짜(YYYY-MM-DD)의 '포함형' 일수 차
  function daysBetweenInclusive(a: string, b: string): number {
    if (!a || !b) return Infinity;
    const aDt = new Date(a + "T00:00:00");
    const bDt = new Date(b + "T00:00:00");
    const s = Math.min(aDt.getTime(), bDt.getTime());
    const e = Math.max(aDt.getTime(), bDt.getTime());
    return Math.floor((e - s) / (24 * 60 * 60 * 1000)) + 1;
  }

  // YYYY-MM-DD 문자열에 n일 더하기
  function addDaysStr(base: string, n: number): string {
    const [y, m, d] = base.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + n);
    return formatDateLocal(dt);
  }

  // 추가: 날짜 상태
  const today = new Date();
  const defaultTo = formatDateLocal(today); // ✅ 로컬 오늘 날짜
  const defaultFrom = formatDateLocal(new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000)); // 3개월 전

  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);
  const fromRef = useRef<HTMLInputElement | null>(null);
  const toRef = useRef<HTMLInputElement | null>(null);

  // ⬇️ 백엔드 에러(1년 초과) 시 되돌릴 '마지막 유효 값'
  const prevFromRef = useRef(fromDate);
  const prevToRef = useRef(toDate);

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
        if (aDone !== bDone) return aDone ? 1 : -1; // 미완료 우선
        return new Date(b.cutAt).getTime() - new Date(a.cutAt).getTime(); // 최신순
      });

      setRows(sorted);

      // ✅ 호출 성공 시 현재 선택 범위를 '유효값'으로 기록
      prevFromRef.current = fromDate;
      prevToRef.current = toDate;
    } catch (e: any) {
      const msg = e?.message || e?.toString?.() || "";
      // ⛑️ 백엔드가 1년 제한으로 400을 던질 때
      if (msg.includes("365") || msg.includes("1년") || msg.includes("최대")) {
        alert("검색 기간은 최대 1년까지만 가능합니다.");
        // ✅ 마지막 유효 범위로 되돌리기
        if (fromDate !== prevFromRef.current) setFromDate(prevFromRef.current);
        if (toDate !== prevToRef.current) setToDate(prevToRef.current);
      }
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  function isTimelineComplete(timeline: TimelineDto) {
    const items = timeline.items ?? [];

    // 1) 판매 미완료 아이템이 있으면 무조건 미완료
    const allSold = items.length > 0 && items.every(it => it.isSold === true);
    if (!allSold) return false;

    // 2) 전 아이템이 '혈비 귀속'이면(= 분배 불필요) 판매완료만으로 완료 처리
    const allTreasury = items.length > 0 && items.every(it => (it.toTreasury ?? it.isTreasury) === true);
    if (allTreasury) return true;

    // 3) 일반 분배 방식은 '모든 분배 완료'까지 완료로 본다
    const dists = timeline.distributions ?? [];
    const allPaid = dists.length > 0 && dists.every(d => d.isPaid === true);
    return allPaid;
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
          className="ui-input"
          placeholder="보스명 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        {/* 상태 필터 */}
        <select
          className="ui-select"
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
          <div className="ui-date-wrap">
            <input
              ref={fromRef}
              type="date"
              className="ui-date"
              value={fromDate}
              // ✅ toDate 기준 최대 1년 범위로 제한
              min={addDaysStr(toDate, -365)}
              max={toDate}
              onChange={(e) => {
                const nextFrom = e.currentTarget.value;
                if (!nextFrom) return;
                if (daysBetweenInclusive(nextFrom, toDate) > 365) {
                  alert("검색 기간은 최대 1년까지만 가능합니다.");
                  // 상태 변경하지 않음 → 그대로 유지(되돌리기 효과)
                  e.currentTarget.value = fromDate;
                  return;
                }
                setFromDate(nextFrom);
              }}
            />
            <button
              type="button"
              className="ui-date-btn"
              onClick={() => fromRef.current?.showPicker?.()}
              aria-label="날짜 선택"
              title="날짜 선택"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeWidth="2" d="M8 2v3M16 2v3M3 8h18M5 12h14M5 16h10" />
              </svg>
            </button>
          </div>
          <span>~</span>
          <div className="ui-date-wrap">
            <input
              ref={toRef}
              type="date"
              className="ui-date"
              value={toDate}
              // ✅ fromDate 기준 최대 1년 범위로 제한
              min={fromDate}
              max={addDaysStr(fromDate, 365)}
              onChange={(e) => {
                const nextTo = e.currentTarget.value;
                if (!nextTo) return;
                if (daysBetweenInclusive(fromDate, nextTo) > 365) {
                  alert("검색 기간은 최대 1년까지만 가능합니다.");
                  e.currentTarget.value = toDate;
                  return;
                }
                setToDate(nextTo);
              }}
            />
            <button
              type="button"
              className="ui-date-btn"
              onClick={() => toRef.current?.showPicker?.()}
              aria-label="날짜 선택"
              title="날짜 선택"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeWidth="2" d="M8 2v3M16 2v3M3 8h18M5 12h14M5 16h10" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* 표 → rows만 스크롤 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-900/80 backdrop-blur z-10">
            <tr className="text-left text-xs text-white/60">
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
                <td colSpan={7} className="py-6 text-center text-white/60">
                  불러오는 중…
                </td>
              </tr>
            ) : tableRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-white/50 italic">
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
                    <tr key={t.id} className="border-t border-white/10 text-white/50">
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
                            className="px-2 py-1 rounded bg-white/15 text-white text-xs hover:bg-white/20"
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
                            className="px-2 py-1 rounded bg-rose-500/80 text-white text-xs hover:bg-rose-500"
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
                    className={`border-t border-white/10 ${
                      s.kind === "DIST_SALE_DONE_UNPAID" ? "bg-orange-500/15" : ""
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
                          className="px-2 py-1 rounded bg-white/15 text-white text-xs hover:bg-white/20"
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
                          className="px-2 py-1 rounded bg-rose-500/80 text-white text-xs hover:bg-rose-500"
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
