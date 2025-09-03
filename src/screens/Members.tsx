import React, { useEffect, useMemo, useState } from "react";
import Card from "../components/common/Card";
import PageHeader from "../components/common/PageHeader";
import { useAuth } from "../contexts/AuthContext";
import { postJSON } from "@/lib/http";

type Role = "SUPERADMIN" | "ADMIN" | "LEADER" | "USER";
type MemberRow = {
  id: string;
  loginId: string;
  role: Role;
  createdAt: string | null;
};

const MAX_MEMBERS = 49;

export default function Members() {
  const { role, user, logout } = useAuth(); // ← logout 사용
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<MemberRow[]>([]);
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [changingId, setChangingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const canManage = useMemo(() => role === "ADMIN" || role === "LEADER", [role]);
  if (!canManage) return <div className="text-sm text-red-600">접근 권한이 없습니다.</div>;

  const isSelf = (m: MemberRow) => user?.loginId && m.loginId === user.loginId;

  const load = async () => {
    setLoading(true);
    try {
      const r = await postJSON<{ ok: true; members: MemberRow[]; count: number }>("/v1/members");
      setList(r.members);
    } catch (e: any) {
      alert(e.message ?? "목록 조회 실패");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const addMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginId || !password) return;
    if (list.length >= MAX_MEMBERS) {
      alert(`혈맹원은 최대 ${MAX_MEMBERS}명까지 등록할 수 있습니다.`);
      return;
    }
    setCreating(true);
    try {
      await postJSON("/v1/members", { loginId, password, role: "USER" });
      setLoginId(""); setPassword("");
      await load();
    } catch (e: any) {
      const msg = e?.body?.message || e?.message || "생성 실패";
      alert(msg);
    } finally {
      setCreating(false);
    }
  };

  const toggleLeader = async (m: MemberRow) => {
    if (changingId || isSelf(m)) return;
    setChangingId(m.id);
    try {
      const next = m.role === "LEADER" ? "USER" : "LEADER";
      await postJSON(`/v1/members/${m.id}/role`, { role: next });
      setList((prev) => prev.map(x => x.id === m.id ? { ...x, role: next as Role } : x));
    } catch (e: any) {
      alert(e?.body?.message || e.message || "권한 변경 실패");
    } finally {
      setChangingId(null);
    }
  };

  const assignAdmin = async (m: MemberRow) => {
    if (assigningId || isSelf(m)) return;
    if (role !== "ADMIN") {
      alert("관리자만 위임할 수 있습니다.");
      return;
    }
    if (!confirm(`정말 ${m.loginId}에게 관리자 권한을 위임할까요? 현재 관리자는 간부로 내려갑니다.`)) return;
    setAssigningId(m.id);
    try {
      await postJSON<{ ok: true; demoted: number; promotedId: string; newRole: string }>(`/v1/members/${m.id}/assign-admin`, {});
      await load();
      alert("관리자 권한을 위임했습니다. 다시 로그인해 주세요.");
      logout(); // ✅ 안내 후 즉시 로그아웃
    } catch (e: any) {
      alert(e?.body?.message || e.message || "관리자 위임 실패");
    } finally {
      setAssigningId(null);
    }
  };

  const remove = async (m: MemberRow) => {
    if (isSelf(m)) {
      alert("자기 자신은 삭제할 수 없습니다.");
      return;
    }
    if (!confirm(`정말 삭제할까요? (${m.loginId})`)) return;
    setDeletingId(m.id);
    try {
      await postJSON(`/v1/members/${m.id}/delete`, {});
      setList((prev) => prev.filter(x => x.id !== m.id));
    } catch (e: any) {
      alert(e?.body?.message || e.message || "삭제 실패");
    } finally {
      setDeletingId(null);
    }
  };

  function fmtDate(s?: string | null) {
    if (!s) return "-";
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleString("ko-KR", { hour12: false });
  }

  return (
    <div className="space-y-4">
      <PageHeader title="혈맹원 관리" subtitle="추가 / 권한변경 / 삭제" />

      <Card>
        <form onSubmit={addMember} className="grid md:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-sm mb-1">아이디</label>
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">비밀번호</label>
            <input
              type="password"
              className="w-full border rounded-lg px-3 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {/* 👇 여기 문구 추가 */}
          </div>
          <div>
            <button
              type="submit"
              disabled={creating || !loginId || !password || list.length >= 49}
              className={`w-full px-4 py-2 rounded-xl ${
                (!creating && loginId && password && list.length < 49)
                  ? "bg-slate-900 text-white"
                  : "bg-gray-200 text-gray-500 cursor-not-allowed"
              }`}
            >
              {creating ? "추가 중..." : "혈맹원 추가 (기본: 혈맹원 권한)"}
            </button>
          </div>
        </form>
            <p className="mt-1 text-xs text-gray-500">
              혈맹원은 최대 49명까지 입력할 수 있습니다. (현재 {list.length}명)
            </p>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">혈맹원 목록</h3>
          <span className="text-sm text-gray-500">총 {list.length}명</span>
        </div>
        {loading ? (
          <div className="py-8 text-center text-sm text-gray-500">불러오는 중...</div>
        ) : list.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400 italic">등록된 혈맹원이 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-gray-500">
                <tr className="border-b">
                  <th className="py-2 pr-4">아이디</th>
                  <th className="py-2 pr-4">권한</th>
                  <th className="py-2 pr-4">가입일</th>
                  <th className="py-2 text-right">액션</th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => {
                  const self = user?.loginId === m.loginId; // 항상 boolean
                  const isTargetAdmin = m.role === "ADMIN";
                  const isTargetLeader = m.role === "LEADER";
                  const isTargetUser = m.role === "USER";
                  const iAmAdmin = role === "ADMIN";
                  const iAmLeader = role === "LEADER";

                  return (
                    <tr key={m.id} className="border-b">
                      <td className="py-2 pr-4">{m.loginId}</td>
                      <td className="py-2 pr-4">
                        {isTargetLeader ? "간부" : isTargetAdmin ? "관리자" : isTargetUser ? "혈맹원" : m.role}
                      </td>
                      <td className="py-2 pr-4">{fmtDate(m.createdAt)}</td>
                      <td className="py-2 text-right space-x-2">
                        {/* 간부 지정/해제: ⚠️ 관리자만 가능. 자기 자신 금지 */}
                        {iAmAdmin && !self && (
                          <button
                            disabled={changingId === m.id || isTargetAdmin} // 관리자 계정에는 적용 불가
                            onClick={() => toggleLeader(m)}
                            className="px-3 py-1.5 rounded-lg border hover:bg-slate-50 disabled:opacity-50"
                            title={self ? "자기 자신은 변경할 수 없습니다." : undefined}
                          >
                            {isTargetLeader ? "간부 해제" : "간부 지정"}
                          </button>
                        )}

                        {/* 관리자 위임: ⚠️ 관리자만 / 자기 자신 금지 / 대상은 USER 또는 LEADER */}
                        {iAmAdmin && !self && isTargetLeader && (
                          <button
                            disabled={assigningId === m.id}
                            onClick={() => assignAdmin(m)}
                            className="px-3 py-1.5 rounded-lg border hover:bg-slate-50 disabled:opacity-50"
                          >
                            관리자 위임
                          </button>
                        )}

                        {/* 삭제:
                            - 관리자: 자기 자신만 금지(그 외 모두 가능)
                            - 간부: USER만 삭제 가능, 간부/관리자 삭제 불가, 자기 자신 금지
                        */}
                        <button
                          disabled={
                            deletingId === m.id ||
                            self ||
                            (iAmLeader && !isTargetUser) // 간부는 USER만 삭제 가능
                          }
                          onClick={() => remove(m)}
                          className="px-3 py-1.5 rounded-lg border hover:bg-slate-50 disabled:opacity-50"
                          title={
                            self
                              ? "자기 자신은 삭제할 수 없습니다."
                              : iAmLeader && !isTargetUser
                              ? "간부는 혈맹원만 삭제할 수 있습니다."
                              : undefined
                          }
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}