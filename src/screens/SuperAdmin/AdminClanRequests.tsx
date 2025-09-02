import { useState, useEffect } from "react";
import Card from "../../components/common/Card";
import PageHeader from "../../components/common/PageHeader";
import { useAuth } from "../../contexts/AuthContext";
import { getJSON, postJSON } from "../../lib/http";

type Row = {
  id: string;                 // BigInt -> string
  world: string;
  serverNo: number;
  clanName: string;
  depositorName: string;
  createdAt: string;          // ISO
  status: "PENDING" | "APPROVED" | "REJECTED";
};

type ListResp = {
  ok: true;
  pending: Row[];
  processed: Row[]; // 최근 처리 3건
};

export default function AdminClanRequests() {
  const { role } = useAuth();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Row[]>([]);
  const [processed, setProcessed] = useState<Row[]>([]);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  useEffect(() => {
    if (role !== "SUPERADMIN") return;
    (async () => {
      try {
        const r = await getJSON<ListResp>("/v1/admin/clan-requests");
        setPending(r.pending);
        setProcessed(r.processed);
      } catch (e: any) {
        alert(e.message ?? "목록 조회 실패");
      } finally {
        setLoading(false);
      }
    })();
  }, [role]);

  const onAction = async (id: string, action: "approve" | "reject") => {
    if (submittingId) return;
    setSubmittingId(id);
    try {
      await postJSON(`/v1/admin/clan-requests/${id}/${action}`, {}); // note 필요하면 {note:""} 전달
      // 낙관적 업데이트: pending에서 제거하고 processed 맨 앞에 추가(최대 3 유지)
      setPending((prev) => prev.filter((r) => r.id !== id));
      setProcessed((prev) => {
        const found = pending.find((r) => r.id === id);
        if (!found) return prev;
        const applied: Row = {
          ...found,
          status: action === "approve" ? "APPROVED" : "REJECTED",
          createdAt: found.createdAt,
        };
        const next = [applied, ...prev];
        return next.slice(0, 3);
      });
    } catch (e: any) {
      alert(e.message ?? "처리 실패");
    } finally {
      setSubmittingId(null);
    }
  };

  const ServerCell = ({ world, serverNo }: { world: string; serverNo: number }) => (
    <span>{world}{serverNo}서버</span>
  );

  if (role !== "SUPERADMIN") {
    return <div className="text-sm text-red-600">접근 권한이 없습니다.</div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader title="혈맹 등록요청 처리" subtitle="대기 목록 + 최근 처리 3건" />
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">대기중 요청</h3>
          <span className="text-sm text-gray-500">건수: <b>{pending.length}</b></span>
        </div>
        {loading ? (
          <div className="py-8 text-center text-sm text-gray-500">불러오는 중...</div>
        ) : pending.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400 italic">대기중인 요청이 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-gray-500">
                <tr className="border-b">
                  <th className="py-2 pr-4">서버</th>
                  <th className="py-2 pr-4">혈맹이름</th>
                  <th className="py-2 pr-4">입금자명</th>
                  <th className="py-2 pr-4">등록요청일시</th>
                  <th className="py-2 text-right">처리</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((row) => (
                  <tr key={row.id} className="border-b">
                    <td className="py-2 pr-4"><ServerCell world={row.world} serverNo={row.serverNo} /></td>
                    <td className="py-2 pr-4">{row.clanName}</td>
                    <td className="py-2 pr-4">{row.depositorName}</td>
                    <td className="py-2 pr-4">{new Date(row.createdAt).toLocaleString()}</td>
                    <td className="py-2 text-right space-x-2">
                      <button
                        disabled={submittingId === row.id}
                        onClick={() => onAction(row.id, "approve")}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:opacity-90 disabled:opacity-50"
                      >
                        등록처리
                      </button>
                      <button
                        disabled={submittingId === row.id}
                        onClick={() => onAction(row.id, "reject")}
                        className="px-3 py-1.5 rounded-lg border hover:bg-slate-50 disabled:opacity-50"
                      >
                        반려
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">최근 처리 3건</h3>
          <span className="text-sm text-gray-500">건수: <b>{processed.length}</b></span>
        </div>
        {processed.length === 0 ? (
          <div className="py-6 text-center text-sm text-gray-400 italic">최근 처리 건이 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-gray-500">
                <tr className="border-b">
                  <th className="py-2 pr-4">서버</th>
                  <th className="py-2 pr-4">혈맹이름</th>
                  <th className="py-2 pr-4">입금자명</th>
                  <th className="py-2 pr-4">등록요청일시</th>
                  <th className="py-2 pr-4">결과</th>
                </tr>
              </thead>
              <tbody>
                {processed.map((row) => (
                  <tr key={row.id} className="border-b">
                    <td className="py-2 pr-4"><ServerCell world={row.world} serverNo={row.serverNo} /></td>
                    <td className="py-2 pr-4">{row.clanName}</td>
                    <td className="py-2 pr-4">{row.depositorName}</td>
                    <td className="py-2 pr-4">{new Date(row.createdAt).toLocaleString()}</td>
                    <td className="py-2 pr-4">{row.status === "APPROVED" ? "등록처리" : "반려"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}