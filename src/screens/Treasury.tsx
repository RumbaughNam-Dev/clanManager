// src/screens/Treasury.tsx
import React, { useEffect, useMemo, useState } from "react";
import PageHeader from "../components/common/PageHeader";
import Card from "../components/common/Card";
import Pill from "../components/common/Pill";
import Modal from "../components/common/Modal";
import { postJSON } from "@/lib/http";
import type { Role } from "../contexts/AuthContext";

type EntryType = "SALE_TREASURY" | "MANUAL_IN" | "MANUAL_OUT";

type ListResp = {
  ok: true;
  page: number;
  size: number;
  total: number;
  balance: number;
  items: Array<{
    id: string;
    at: string;                 // ISO
    type: "IN" | "OUT";         // 화면용
    entryType: EntryType;       // 원본 타입
    source: string;             // 출처/용도(백엔드 문자열 그대로)
    amount: number;             // 양수
    by: string;                 // 작성자
    bossName?: string | null;
    itemName?: string | null;
  }>;
};

function fmt(dt?: string) {
  if (!dt) return "-";
  const d = new Date(dt);
  return isNaN(d.getTime()) ? dt : d.toLocaleString("ko-KR", { hour12: false });
}

function range(a: number, b: number) {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

/** (선택) source 끝에 붙은 "(숫자 / 숫자)" 꼬리표 제거 */
function stripTrailingIdPair(s: string) {
  return s.replace(/\s*\(\s*\d+\s*\/\s*\d+\s*\)\s*$/, "");
}

export default function Treasury({ role }: { role: Role }) {
  // ✅ LEADER도 사용 가능
  const canUse = role === "ADMIN" || role === "SUPERADMIN" || role === "LEADER";

  const [page, setPage] = useState(1);
  const [size] = useState(10);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [balance, setBalance] = useState(0);
  const [rows, setRows] = useState<ListResp["items"]>([]);
  const [total, setTotal] = useState(0);

  // ── 수동 입력(유입) 모달 상태 ───────────────────────
  const [openIn, setOpenIn] = useState(false);
  const [inSource, setInSource] = useState("");
  const [inAmount, setInAmount] = useState<string>("");
  const [inSubmitting, setInSubmitting] = useState(false);
  const [inError, setInError] = useState<string | null>(null);

  // ── 수동 사용(출금) 모달 상태 ───────────────────────
  const [openOut, setOpenOut] = useState(false);
  const [outReason, setOutReason] = useState("");
  const [outAmount, setOutAmount] = useState<string>("");
  const [outSubmitting, setOutSubmitting] = useState(false);
  const [outError, setOutError] = useState<string | null>(null);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / size)), [total, size]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const data = await postJSON<ListResp>(`/v1/treasury?page=${page}&size=${size}`);
      if (!data || !Array.isArray(data.items)) {
        console.warn("[Treasury] unexpected response shape:", data);
      }
      setRows(data.items ?? []);
      setBalance(data.balance ?? 0);
      setTotal(data.total ?? 0);
    } catch (e: any) {
      console.error(e);
      setErr(e?.message ?? "목록을 불러오지 못했습니다.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, size]);

  // ── 수동 입력 저장 ─────────────────────────────────
  async function submitManualIn(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (inSubmitting) return;

    const amt = Number(String(inAmount).replace(/[,\s]/g, ""));
    if (!inSource.trim()) {
      setInError("출처를 입력하세요.");
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      setInError("금액을 올바르게 입력하세요(0보다 커야 합니다).");
      return;
    }

    try {
      setInSubmitting(true);
      setInError(null);
      // 백엔드: POST /v1/treasury/manual-in { amount, source }
      await postJSON("/v1/treasury/manual-in", {
        amount: amt,
        source: inSource.trim(),
      });

      // 성공 → 모달 닫고, 폼 초기화, 첫 페이지로 이동 후 리로드(가장 최신건을 바로 보이게)
      setOpenIn(false);
      setInSource("");
      setInAmount("");
      setPage(1);
      await load();
    } catch (e: any) {
      console.error(e);
      setInError(e?.message ?? "저장에 실패했습니다.");
    } finally {
      setInSubmitting(false);
    }
  }

  // ── 수동 사용 저장 ─────────────────────────────────
  async function submitManualOut(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (outSubmitting) return;

    const amt = Number(String(outAmount).replace(/[,\s]/g, ""));
    if (!outReason.trim()) {
      setOutError("사용처(사유)를 입력하세요.");
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      setOutError("금액을 올바르게 입력하세요(0보다 커야 합니다).");
      return;
    }

    try {
      setOutSubmitting(true);
      setOutError(null);
      // 백엔드: POST /v1/treasury/manual-out { amount, note }
      await postJSON("/v1/treasury/manual-out", {
        amount: amt,
        note: outReason.trim(),
      });

      // 성공 → 모달 닫고 초기화, 첫 페이지로 이동 후 리로드
      setOpenOut(false);
      setOutReason("");
      setOutAmount("");
      setPage(1);
      await load();
    } catch (e: any) {
      console.error(e);
      setOutError(e?.message ?? "저장에 실패했습니다.");
    } finally {
      setOutSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="혈비 관리"
        subtitle="투명성 보장: 모든 멤버 열람 가능"
        right={<Pill>잔액 {balance.toLocaleString()}</Pill>}
      />

      <div className="flex gap-2">
        {canUse && (
          <button
            className="px-3 py-1.5 rounded-lg bg-slate-900 text-white"
            onClick={() => {
              setInError(null);
              setOpenIn(true);
            }}
          >
            혈비 수동 입력
          </button>
        )}
        {canUse && (
          <button
            className="px-3 py-1.5 rounded-lg bg-slate-900 text-white"
            onClick={() => {
              setOutError(null);
              setOpenOut(true);
            }}
          >
            혈비 사용하기
          </button>
        )}
      </div>

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th className="py-2">일시</th>
              <th>구분</th>
              <th>출처/용도</th>
              <th>금액</th>
              <th>작성자</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-500">불러오는 중…</td>
              </tr>
            ) : err ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-rose-600">{err}</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-400 italic">내역이 없습니다.</td>
              </tr>
            ) : (
              rows.map((r) => {
                const label =
                  r.entryType === "SALE_TREASURY"
                    ? "보스 루팅아이템 판매"
                    : stripTrailingIdPair(r.source);

                return (
                  <tr key={r.id} className="border-t">
                    <td className="py-2">{fmt(r.at)}</td>
                    <td>
                      {r.type === "IN"
                        ? <Pill tone="success">유입</Pill>
                        : <Pill tone="danger">사용</Pill>}
                    </td>
                    <td>
                      {label}
                      {(r.bossName || r.itemName) && (
                        <span className="ml-2 text-xs text-slate-500">
                          {r.bossName ? `[${r.bossName}]` : ""}{r.itemName ? ` ${r.itemName}` : ""}
                        </span>
                      )}
                    </td>
                    <td className={r.type === "IN" ? "text-green-600" : "text-red-600"}>
                      {r.type === "IN" ? "+" : "-"}{r.amount.toLocaleString()}
                    </td>
                    <td>{r.by}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* 페이지네이션 */}
        <div className="mt-3 flex items-center justify-center gap-1">
          <button
            className="px-2 py-1 rounded border text-xs disabled:opacity-40"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            이전
          </button>

          {useMemo(() => {
            const maxButtons = 7;
            if (totalPages <= maxButtons) return range(1, totalPages);
            const start = Math.max(1, page - 2);
            const end = Math.min(totalPages, page + 2);
            const pages: number[] = [];
            if (start > 1) pages.push(1);
            if (start > 2) pages.push(-1); // …
            pages.push(...range(start, end));
            if (end < totalPages - 1) pages.push(-2); // …
            if (end < totalPages) pages.push(totalPages);
            return pages;
          }, [page, totalPages]).map((p, i) =>
            p < 0 ? (
              <span key={`e${i}`} className="px-2 text-xs text-slate-400">…</span>
            ) : (
              <button
                key={p}
                className={`px-2 py-1 rounded border text-xs ${p === page ? "bg-slate-900 text-white border-slate-900" : ""}`}
                onClick={() => setPage(p)}
              >
                {p}
              </button>
            )
          )}

          <button
            className="px-2 py-1 rounded border text-xs disabled:opacity-40"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            다음
          </button>
        </div>
      </Card>

      {/* ── 혈비 수동 입력 모달 ───────────────────── */}
      <Modal
        open={openIn}
        onClose={() => {
          if (inSubmitting) return;
          setOpenIn(false);
        }}
        title="혈비 수동 입력"
        footer={
          <div className="flex justify-end gap-2">
            <button
              className="px-3 py-1.5 rounded-lg hover:bg-gray-100"
              onClick={() => setOpenIn(false)}
              disabled={inSubmitting}
            >
              취소
            </button>
            <button
              className={`px-3 py-1.5 rounded-lg text-white ${inSubmitting ? "bg-gray-300" : "bg-slate-900 hover:opacity-90"}`}
              onClick={submitManualIn}
              disabled={inSubmitting}
            >
              {inSubmitting ? "저장 중…" : "확인"}
            </button>
          </div>
        }
      >
        <form onSubmit={submitManualIn} className="space-y-3">
          {inError && <div className="text-sm text-rose-600">{inError}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">출처</label>
              <input
                className="w-full border rounded-lg px-2 py-2"
                placeholder="예: 혈 레이드, 분배하기 애매한 템"
                value={inSource}
                onChange={(e) => setInSource(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm mb-1">금액</label>
              <input
                type="number"
                className="w-full border rounded-lg px-2 py-2"
                placeholder="0"
                value={inAmount}
                onChange={(e) => setInAmount(e.target.value)}
                min={1}
                step="1"
              />
            </div>
          </div>
        </form>
      </Modal>

      {/* ── 혈비 사용하기 모달 ───────────────────── */}
      <Modal
        open={openOut}
        onClose={() => {
          if (outSubmitting) return;
          setOpenOut(false);
        }}
        title="혈비 사용하기"
        footer={
          <div className="flex justify-end gap-2">
            <button
              className="px-3 py-1.5 rounded-lg hover:bg-gray-100"
              onClick={() => setOpenOut(false)}
              disabled={outSubmitting}
            >
              취소
            </button>
            <button
              className={`px-3 py-1.5 rounded-lg text-white ${outSubmitting ? "bg-gray-300" : "bg-slate-900 hover:opacity-90"}`}
              onClick={submitManualOut}
              disabled={outSubmitting}
            >
              {outSubmitting ? "저장 중…" : "확인"}
            </button>
          </div>
        }
      >
        <form onSubmit={submitManualOut} className="space-y-3">
          {outError && <div className="text-sm text-rose-600">{outError}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">사용처 / 사유</label>
              <input
                className="w-full border rounded-lg px-2 py-2"
                placeholder="예: 열쇠 제작, 이벤트 보상"
                value={outReason}
                onChange={(e) => setOutReason(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm mb-1">금액</label>
              <input
                type="number"
                className="w-full border rounded-lg px-2 py-2"
                placeholder="0"
                value={outAmount}
                onChange={(e) => setOutAmount(e.target.value)}
                min={1}
                step="1"
              />
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
}