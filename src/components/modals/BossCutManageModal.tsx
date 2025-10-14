// src/components/modals/BossCutManageModal.tsx
import React, { useEffect, useRef, useState } from "react";
import Modal from "../common/Modal";
import { postJSON } from "@/lib/http";
import { useAuth } from "@/contexts/AuthContext";
import CutModal from "@/screens/DashBoard/CutModal";

type LootItemDto = {
  id: string;
  itemName: string;
  isSold: boolean;
  isTreasury?: boolean;
  toTreasury?: boolean;
  soldPrice?: number | null;
  soldAt?: string | null;
  looterLoginId?: string | null; // ✅ per-item 루팅자
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
    bossMetaId: string | null;
    id: string;
    bossName: string;
    cutAt: string;       // ISO
    createdBy: string;   // 기록자(loginId)
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
  const { user } = useAuth(); // ✅ 현재 로그인 사용자 (user?.loginId 사용)
  const myId = user?.loginId ?? null;

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<DetailResp["item"] | null>(null);

  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [sellInput, setSellInput] = useState<Record<string, string>>({});
  const [savingItemId, setSavingItemId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const modalBodyRef = useRef<HTMLDivElement | null>(null);

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
      for (const it of res.item.items) next[it.id] = typeof it.soldPrice === "number" ? String(it.soldPrice) : "";
      setSellInput(next);
      if (!activeItemId) setActiveItemId(res.item.items?.[0]?.id ?? null);
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
      const res = await postJSON<DetailResp>(`/v1/boss-timelines/${timelineId}`);
      setData(res.item);
      setActiveItemId(res.item.items?.[0]?.id ?? null);
      const next: Record<string, string> = {};
      for (const it of res.item.items) next[it.id] = typeof it.soldPrice === "number" ? String(it.soldPrice) : "";
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

  // ✅ 권한 체크
  const isCreator = (loginId?: string | null) => !!loginId && !!data && loginId === data.createdBy;
  const isLooterOf = (it: LootItemDto, loginId?: string | null) =>
    !!loginId && !!it.looterLoginId && it.looterLoginId === loginId;

  const canCompleteSale = (it: LootItemDto) =>
    !!myId && (!!data && (myId === data.createdBy || isLooterOf(it, myId)));

  const canMarkPaid = (d: DistributionDto, parentItem?: LootItemDto | undefined) => {
    if (!myId) return false;
    if (!data) return false;
    // 작성자: 모두 가능
    if (myId === data.createdBy) return true;
    // 본인(수령자): 가능
    if (d.recipientLoginId === myId) return true;
    // 해당 아이템 루팅자: 그 아이템에 대해서만 가능
    if (parentItem && isLooterOf(parentItem, myId)) return true;
    return false;
  };

  const filteredDists = (data?.distributions ?? []).filter(d => {
    if (!activeItemId) return false;
    return d.lootItemId === activeItemId;
  });

  // ─────────────────────────────────────────────
  // [새 기능] 참여자 빠른 선택: 아이디 입력 후 Enter → 해당 혈원 체크박스 '체크'
  //  - 목록을 필터링하지 않음
  //  - 정확한 아이디가 없으면 alert
  //  - 체크박스는 DOM에서 data-loginid 로 찾고 .click()으로 onChange 트리거
  // ─────────────────────────────────────────────
  const participantListRef = useRef<HTMLDivElement | null>(null);
  const [quickPick, setQuickPick] = useState("");
  const handleQuickPickEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = quickPick.trim();
    if (!q) return;
    // 검색 범위: 참여자 체크박스 리스트 컨테이너 → 없으면 모달 전체
    const root: ParentNode = participantListRef.current ?? document;
    // loginId 는 영문/숫자 가정. 특수문자가 있다면 CSS.escape 사용 권장.
    const target = root.querySelector<HTMLInputElement>(`input[type="checkbox"][data-loginid="${q}"]`);
    if (!target) {
      alert("등록되지 않은 혈맹원 입니다.");
      return;
    }
    if (!target.checked) {
      // React onChange 트리거를 위해 click 사용 (직접 checked=true 지정 X)
      target.click();
    }
    setQuickPick("");
    (e.currentTarget as HTMLInputElement).blur(); // 모바일 키보드 내리기
  };

  async function completeSale(itemId: string) {
    if (!timelineId || !data) return;
    const item = data.items.find(x => x.id === itemId);
    if (!item) return;

    // 권한 체크 (작성자 or 해당 아이템 루팅자)
    if (!canCompleteSale(item)) {
      alert("판매처리는 보스컷 작성자 또는 해당 아이템 루팅자만 가능합니다.");
      return;
    }

    const raw = (sellInput[itemId] ?? "").trim();
    const price = Number(raw.replace(/[, ]/g, ""));
    if (!Number.isFinite(price) || price <= 0) {
      alert("판매가를 숫자로 입력하세요. (세금을 제한 실제 정산가)");
      return;
    }
    try {
      setSavingItemId(itemId);
      await postJSON(`/v1/boss-timelines/${timelineId}/items/${itemId}/sell`, { soldPrice: price });
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
    if (!timelineId || !data) return;
    const parentItem = data.items.find(x => x.id === itemId);

    // 권한 체크: 작성자 or 본인(수령자) or 해당 아이템 루팅자
    if (!canMarkPaid({ lootItemId: itemId, recipientLoginId, isPaid: false }, parentItem)) {
      alert("분배처리는 해당 아이템 루팅자/보스컷 작성자/분배받는 본인만 가능합니다.");
      return;
    }

    try {
      await postJSON(
        `/v1/boss-timelines/${timelineId}/items/${itemId}/distributions/${encodeURIComponent(recipientLoginId)}`,
        { isPaid: true }
      );
      await reloadDetail();
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

  function formatLocalDateTime(d: Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      d.getFullYear() +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      " " +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes()) +
      ":" +
      pad(d.getSeconds())
    );
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
      <div ref={modalBodyRef}>
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
                  <col style={{ width: "22%" }} />
                  <col style={{ width: "48%" }} />
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
                    const looter = it.looterLoginId ?? "—";
                    const allowSale = canCompleteSale(it);

                    return (
                      <tr key={it.id} className="border-t">
                        <td className="py-2 px-3">
                          <div className="font-medium">{it.itemName}</div>
                          <div className="text-[12px] text-slate-500 mt-0.5">
                            루팅자: <span className="font-medium">{looter}</span>
                          </div>
                          {treasury && <div className="text-[11px] text-amber-600 mt-0.5">혈비 귀속</div>}
                        </td>

                        <td className="px-3">
                          {treasury ? (
                            it.isSold ? (
                              <div className="flex items-center gap-3">
                                <div className="font-semibold text-emerald-600">
                                  {typeof it.soldPrice === "number" ? it.soldPrice.toLocaleString() : "-"}
                                </div>
                                <div className="text-xs text-emerald-500">혈비귀속 판매완료</div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <input
                                  className="border rounded-lg px-2 py-1 w-[18rem]"
                                  placeholder="세금을 제한 실제 정산가 입력"
                                  value={sellInput[it.id] ?? ""}
                                  onChange={(e) => setSellInput((p) => ({ ...p, [it.id]: e.target.value }))}
                                  onKeyDown={(e) => { 
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (allowSale) {
                                        completeSale(it.id);
                                      } else {
                                        alert("판매처리는 보스컷 작성자 또는 해당 아이템 루팅자만 가능합니다.");
                                      }
                                    }
                                   }}
                                  inputMode="numeric"
                                  disabled={!allowSale}
                                  title={allowSale ? "" : "보스컷 작성자 또는 해당 아이템 루팅자만 판매처리가 가능합니다."}
                                />
                                <div
                                  role="button"
                                  tabIndex={0}
                                  className={`px-3 py-1.5 rounded-lg text-white select-none ${
                                    savingItemId === it.id
                                      ? "bg-gray-300"
                                      : allowSale
                                      ? "bg-slate-900 hover:opacity-90 cursor-pointer"
                                      : "bg-gray-300 cursor-not-allowed"
                                  }`}
                                  onMouseDown={(ev) => { ev.preventDefault(); ev.stopPropagation(); }}
                                  onClick={(ev) => {
                                    ev.preventDefault();
                                    ev.stopPropagation();
                                    if (!allowSale) {
                                      alert("판매처리는 보스컷 작성자 또는 해당 아이템 루팅자만 가능합니다.");
                                      return;
                                    }
                                    completeSale(it.id);
                                  }}
                                  aria-disabled={savingItemId === it.id || !allowSale}
                                >
                                  {savingItemId === it.id ? "저장 중…" : "판매완료"}
                                </div>
                              </div>
                            )
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
                                onChange={(e) => setSellInput((p) => ({ ...p, [it.id]: e.target.value }))}
                                onKeyDown={(e) => { 
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (allowSale) {
                                      completeSale(it.id);
                                    } else {
                                      alert("판매처리는 보스컷 작성자 또는 해당 아이템 루팅자만 가능합니다.");
                                    }
                                  }
                                 }}
                                inputMode="numeric"
                                disabled={!allowSale}
                                title={allowSale ? "" : "보스컷 작성자 또는 해당 아이템 루팅자만 판매처리가 가능합니다."}
                              />
                              <div
                                role="button"
                                tabIndex={0}
                                className={`px-3 py-1.5 rounded-lg text-white select-none ${
                                  savingItemId === it.id
                                    ? "bg-gray-300"
                                    : allowSale
                                    ? "bg-slate-900 hover:opacity-90 cursor-pointer"
                                    : "bg-gray-300 cursor-not-allowed"
                                }`}
                                onMouseDown={(ev) => { ev.preventDefault(); ev.stopPropagation(); }}
                                onClick={(ev) => {
                                  ev.preventDefault();
                                  ev.stopPropagation();
                                  if (!allowSale) {
                                    alert("판매처리는 보스컷 작성자 또는 해당 아이템 루팅자만 가능합니다.");
                                    return;
                                  }
                                  completeSale(it.id);
                                }}
                                aria-disabled={savingItemId === it.id || !allowSale}
                              >
                                {savingItemId === it.id ? "저장 중…" : "판매완료"}
                              </div>
                            </div>
                          )}
                        </td>

                        <td className="px-3">
                          {treasury ? (
                            it.isSold
                              ? <span className="text-emerald-600">혈비귀속 판매완료</span>
                              : <span className="text-amber-600">혈비귀속 (판매전)</span>
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
                      title={it.looterLoginId ? `루팅자: ${it.looterLoginId}` : "루팅자: —"}
                    >
                      <input
                        type="radio"
                        name="loot-item-tab"
                        checked={selected}
                        onChange={() => setActiveItemId(it.id)}
                        className="hidden"
                      />
                      <span className="font-medium">{it.itemName}</span>
                      {it.looterLoginId && (
                        <span className="text-[11px] opacity-80">
                          @{it.looterLoginId}
                        </span>
                      )}
                      {isTreasuryItem(it)
                        ? <span className="text-[11px] text-emerald-200">혈비귀속 완료</span>
                        : tabBadge(it)}
                    </label>
                  );
                })
              )}
            </div>

            {/* 선택 아이템의 참여자 분배 리스트 */}
            <div className="border rounded-lg" ref={participantListRef}>
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

                      const allowMarkPaid = canMarkPaid(d, parentItem);

                      return (
                        <tr key={`${d.lootItemId}-${d.recipientLoginId}`} className="border-t">
                           <td className="py-2 px-2">
                           {/* ✅ 체크박스가 별도 리스트(우측 상단)에 있을 경우,
                               그 체크박스 쪽에 data-loginid 를 반드시 달아주세요.
                               만약 이 줄에서도 체크 UI를 렌더링한다면 다음과 같이 data-loginid 속성을 추가하세요. */}
                           {d.recipientLoginId}
                         </td>
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
                                className={`px-3 py-1.5 rounded-lg text-xs ${
                                  allowMarkPaid
                                    ? "bg-slate-900 text-white hover:opacity-90"
                                    : "bg-gray-300 text-white cursor-not-allowed"
                                }`}
                                onClick={() => {
                                  if (!allowMarkPaid) {
                                    alert("분배처리는 해당 아이템 루팅자/보스컷 작성자/분배받는 본인만 가능합니다.");
                                    return;
                                  }
                                  markPaid(d.recipientLoginId, parentItem!.id);
                                }}
                                disabled={!allowMarkPaid}
                                title={
                                  allowMarkPaid
                                    ? ""
                                    : "분배처리는 해당 아이템 루팅자/보스컷 작성자/분배받는 본인만 가능합니다."
                                }
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