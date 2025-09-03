// src/components/modals/BossCutManageModal.tsx
import React, { useEffect, useRef, useState } from "react";
import Modal from "../common/Modal";
import { patchJSON, postJSON, requestJSON } from "@/lib/http";

type LootItemDto = {
  id: string;
  itemName: string;
  isSold: boolean;
  isTreasury?: boolean;
  toTreasury?: boolean;
  soldPrice?: number | null;
  soldAt?: string | null;
  looterLoginId?: string | null;
};

type DistributionDto = {
  id?: string;
  lootItemId: string | null;
  recipientLoginId: string;
  isPaid: boolean;
  amount?: number | null;
};

type DetailResp = {
  ok: true;
  item: {
    id: string;
    bossName: string;
    cutAt: string;       // ISO
    createdBy: string;   // 기록자
    items: LootItemDto[];
    distributions: DistributionDto[];
  };
};

type Props = {
  open: boolean;
  timelineId: string | null;
  onClose: () => void;
  onSaved?: () => void;
};

export default function BossCutManageModal({ open, timelineId, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<DetailResp["item"] | null>(null);

  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [sellInput, setSellInput] = useState<Record<string, string>>({});
  const [savingItemId, setSavingItemId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  function fmtAbs(s?: string | null) {
    if (!s) return "—";
    const d = new Date(s);
    return isNaN(d.getTime()) ? s : d.toLocaleString("ko-KR", { hour12: false });
  }
  function fmtRelative(iso?: string) {
    if (!iso) return "";
    const now = Date.now();
    const t = new Date(iso).getTime();
    if (isNaN(t)) return "";
    let diff = Math.max(0, now - t);
    const msec = 1000, min = 60*msec, hr = 60*min, day = 24*hr;
    const d = Math.floor(diff / day); diff -= d*day;
    const h = Math.floor(diff / hr);  diff -= h*hr;
    const m = Math.floor(diff / min);
    const parts: string[] = [];
    if (d) parts.push(`${d}일`);
    if (h) parts.push(`${h}시간`);
    parts.push(`${m}분`);
    return `${parts.join(" ")} 전`;
  }

  async function reloadDetail() {
    if (!timelineId) return;
    try {
      setLoading(true);
      const res = await postJSON<DetailResp>(`/v1/boss-timelines/${timelineId}`);
      setData(res.item);
      setErr(null);

      const next: Record<string, string> = {};
      for (const it of res.item.items) {
        next[it.id] = typeof it.soldPrice === "number" ? String(it.soldPrice) : "";
      }
      setSellInput(next);

      if (!activeItemId) {
        const firstItemId = res.item.items?.[0]?.id ?? null;
        setActiveItemId(firstItemId);
      }
    } catch (e: any) {
      setErr(e?.message ?? "데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function load() {
    if (!open || !timelineId) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setErr(null);
    setData(null);

    try {
      const res = await requestJSON<DetailResp>(
        "GET",
        `/v1/boss-timelines/${timelineId}`,
        undefined,
        { signal: ac.signal }
      );

      setData(res.item);
      const firstItemId = res.item.items?.[0]?.id ?? null;
      setActiveItemId(firstItemId);

      const next: Record<string, string> = {};
      for (const it of res.item.items) {
        next[it.id] = typeof it.soldPrice === "number" ? String(it.soldPrice) : "";
      }
      setSellInput(next);
    } catch (e: any) {
      if (e?.name === "AbortError" || e?.message?.includes("The user aborted a request")) return;
      console.error("[BossCutManageModal] load failed:", e);
      setErr(e?.message ?? "데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, timelineId]);

  if (!open) return null;

  const isTreasuryItem = (it: LootItemDto) => (it.isTreasury ?? it.toTreasury) === true;

  const itemDistStats = (itemId: string) => {
    const list = (data?.distributions ?? []).filter(d => d.lootItemId === itemId);
    const total = list.length;
    const done = list.filter(d => d.isPaid).length;
    return { total, done, allPaid: total > 0 && done === total };
  };

  function renderNonTreasuryStatus(it: LootItemDto) {
    if (!it.isSold) return <span className="text-amber-600">판매전</span>;
    const { allPaid } = itemDistStats(it.id);
    if (allPaid) return <span className="text-emerald-600">분배 완료</span>;
    return <span className="text-amber-600">판매완료 (분배미완)</span>;
  }

  function tabBadge(it: LootItemDto) {
    if (isTreasuryItem(it)) {
      return <span className="text-[11px] text-emerald-200">혈비귀속 완료</span>;
    }
    if (!it.isSold) return <span className="text-[11px] text-amber-300">판매전</span>;
    const { allPaid } = itemDistStats(it.id);
    if (allPaid) return <span className="text-[11px] text-emerald-200">분배 완료</span>;
    return <span className="text-[11px] text-amber-300">판매완료 (분배미완)</span>;
  }

  const filteredDists = (data?.distributions ?? []).filter(d => {
    if (!activeItemId) return false;
    return d.lootItemId === activeItemId;
  });

  async function completeSale(itemId: string) {
    if (!timelineId || !data) return;
    const raw = (sellInput[itemId] ?? "").trim();
    const price = Number(raw.replace(/[, ]/g, ""));
    if (!Number.isFinite(price) || price <= 0) {
      alert("판매가를 숫자로 입력하세요. (세금을 제한 실제 정산가)");
      return;
    }

    try {
      setSavingItemId(itemId);
      await patchJSON(`/v1/boss-timelines/${timelineId}/items/${itemId}/sell`, { soldPrice: price });
      await reloadDetail();
      onSaved?.();
    } catch (e: any) {
      console.error("[completeSale] failed:", e);
      alert(e?.message ?? "판매 완료 저장에 실패했습니다.");
    } finally {
      setSavingItemId(null);
    }
  }

  // ▶ 분배완료 처리 (미완료자용 버튼)
  async function markPaid(recipientLoginId: string, itemId: string) {
    if (!timelineId) return;
    try {
      await patchJSON(
        `/v1/boss-timelines/${timelineId}/items/${itemId}/distributions/${encodeURIComponent(recipientLoginId)}`,
        { isPaid: true }
      );
      await reloadDetail(); // 팝업은 닫지 않음
      onSaved?.();
    } catch (e: any) {
      console.error("[markPaid] failed:", e);
      alert(e?.message ?? "분배완료 처리에 실패했습니다.");
    }
  }

  function getProgressText(itemId: string) {
    const total = (data?.distributions ?? []).filter(d => d.lootItemId === itemId).length;
    const done = (data?.distributions ?? []).filter(d => d.lootItemId === itemId && d.isPaid).length;
    if (total === 0) return "분배 대상 없음";
    return `${total}명 중 ${done}명 분배완료`;
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="보스 컷 관리"
      maxWidth="max-w-5xl"
      footer={null}
      closeOnOverlay={false}
      closeOnEsc={false}
    >
      <div>
        {loading && <div className="text-sm text-slate-500">불러오는 중…</div>}
        {!loading && err && (
          <div className="text-sm text-rose-600">
            {err}
            <button type="button" className="ml-2 underline" onClick={load}>재시도</button>
          </div>
        )}

        {!loading && !err && data && (
          <div className="space-y-5">
            {/* 헤더 */}
            <div className="flex flex-col gap-1">
              <div className="flex items-baseline gap-3">
                <div className="text-xl font-bold">{data.bossName}</div>
                <div className="text-[13px] text-slate-600">[기록자: {data.createdBy}]</div>
              </div>
              <div className="text-xs text-slate-500">
                {fmtRelative(data.cutAt)}&nbsp;&nbsp;
                <span className="text-slate-400">[{fmtAbs(data.cutAt)}]</span>
              </div>
            </div>

            {/* 아이템 요약 테이블 */}
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <colgroup>
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "50%" }} />
                  <col style={{ width: "30%" }} />
                </colgroup>
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="py-2 px-3">아이템</th>
                    <th className="px-3">판매</th>
                    <th className="px-3">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map(it => {
                    const treasury = isTreasuryItem(it);
                    return (
                      <tr key={it.id} className="border-t">
                        <td className="py-2 px-3">
                          <div className="font-medium">{it.itemName}</div>
                          {treasury && <div className="text-[11px] text-amber-600 mt-0.5">혈비 귀속</div>}
                        </td>

                        <td className="px-3">
                          {treasury ? (
                            <div className="text-emerald-600 font-medium">혈비귀속 완료</div>
                          ) : it.isSold ? (
                            <div className="flex items-center gap-3">
                              <div className="font-semibold">
                                {typeof it.soldPrice === "number" ? it.soldPrice.toLocaleString() : "-"}
                              </div>
                              <div className="text-xs text-slate-500">{getProgressText(it.id)}</div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <input
                                className="border rounded-lg px-2 py-1 w-[18rem]"
                                placeholder="세금을 제한 실제 정산가 입력"
                                value={sellInput[it.id] ?? ""}
                                onChange={(e) =>
                                  setSellInput((p) => ({ ...p, [it.id]: e.target.value }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") e.preventDefault();
                                }}
                                inputMode="numeric"
                              />
                              <div
                                role="button"
                                tabIndex={0}
                                className={`px-3 py-1.5 rounded-lg text-white cursor-pointer select-none ${
                                  savingItemId === it.id ? "bg-gray-300" : "bg-slate-900 hover:opacity-90"
                                }`}
                                onMouseDown={(ev) => { ev.preventDefault(); ev.stopPropagation(); }}
                                onClick={(ev) => {
                                  ev.preventDefault();
                                  ev.stopPropagation();
                                  completeSale(it.id);
                                }}
                                aria-disabled={savingItemId === it.id}
                              >
                                {savingItemId === it.id ? "저장 중…" : "판매완료"}
                              </div>
                            </div>
                          )}
                        </td>

                        <td className="px-3">
                          {treasury ? (
                            <span className="text-emerald-600">혈비귀속 완료</span>
                          ) : (
                            renderNonTreasuryStatus(it)
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 아이템 라디오형 탭 */}
            <div className="flex flex-wrap gap-2">
              {data.items.length === 0 ? (
                <div className="text-sm text-slate-500">드랍 아이템이 없습니다.</div>
              ) : (
                data.items.map(it => {
                  const selected = activeItemId === it.id;
                  return (
                    <label
                      key={it.id}
                      className={`cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm
                        ${selected ? "bg-slate-900 text-white border-slate-900" : "bg-white hover:bg-slate-50 border-slate-200"}`}
                      onClick={() => setActiveItemId(it.id)}
                    >
                      <input
                        type="radio"
                        name="loot-item-tab"
                        checked={selected}
                        onChange={() => setActiveItemId(it.id)}
                        className="hidden"
                      />
                      <span className="font-medium">{it.itemName}</span>
                      {isTreasuryItem(it)
                        ? <span className="text-[11px] text-emerald-200">혈비귀속 완료</span>
                        : tabBadge(it)}
                    </label>
                  );
                })
              )}
            </div>

            {/* 선택 아이템의 참여자 분배 리스트 */}
            <div className="border rounded-lg">
              <div className="px-3 py-2 text-xs text-slate-500 border-b bg-slate-50 rounded-t-lg">
                선택한 아이템의 참여자 / 분배여부
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="py-2 px-2">참여자</th>
                    <th className="px-2">분배여부</th>
                    <th className="px-2">분배액</th>
                    <th className="px-2">액션</th>
                  </tr>
                </thead>
                <tbody>
                  {(!activeItemId || filteredDists.length === 0) ? (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-slate-500">
                        표시할 참여자가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredDists.map(d => {
                      const parentItem = data.items.find(x => x.id === d.lootItemId);
                      const treasury = parentItem ? isTreasuryItem(parentItem) : false;
                      const sold = parentItem?.isSold;

                      let amountText: React.ReactNode = d.amount ?? "-";
                      if (!treasury && sold && (d.amount == null || isNaN(d.amount as any))) {
                        const list = (data?.distributions ?? []).filter(x => x.lootItemId === parentItem!.id);
                        const total = list.length;
                        if (typeof parentItem?.soldPrice === "number" && total > 0) {
                          amountText = Math.floor(parentItem!.soldPrice / total);
                        }
                      }

                      return (
                        <tr key={`${d.lootItemId}-${d.recipientLoginId}`} className="border-t">
                          <td className="py-2 px-2">{d.recipientLoginId}</td>
                          <td className="px-2">
                            {d.isPaid ? (
                              <span className="text-emerald-600">완료</span>
                            ) : (
                              <span className="text-amber-600">미완료</span>
                            )}
                          </td>
                          <td className="px-2">{amountText}</td>
                          <td className="px-2">
                            {!treasury && sold && !d.isPaid ? (
                              <button
                                type="button"
                                className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs"
                                onClick={() => markPaid(d.recipientLoginId, parentItem!.id)}
                              >
                                분배완료처리
                              </button>
                            ) : (
                              <span className="text-slate-300 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}