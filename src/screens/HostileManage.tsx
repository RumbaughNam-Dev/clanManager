import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "../components/common/PageHeader";
import Card from "../components/common/Card";
import Modal from "../components/common/Modal";
import { delJSON, getJSON, postJSON } from "../lib/http";
import { useAuth } from "../contexts/AuthContext";

type MemberRow = {
  id: string;
  loginId: string;
  role: "SUPERADMIN" | "ADMIN" | "LEADER" | "USER";
};

type HostileRow = {
  seq: number;
  clanId: number | string;
  userId: number | string;
  userLoginId?: string | null;
  hostileClanName?: string | null;
  reason: string;
  hostileAt: string;
  createdAt: string;
  delYn?: string | null;
};

function fmtDateTime(value?: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("ko-KR", { hour12: false });
}

function toDatetimeLocalInput(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

export default function HostileManage() {
  const { user, role } = useAuth();
  const canManage = role === "LEADER" || role === "ADMIN";
  const clanId = user?.clanId;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<HostileRow[]>([]);
  const [deleteMode, setDeleteMode] = useState(false);
  const [checkedSeqs, setCheckedSeqs] = useState<Set<number>>(new Set());

  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveDeleting, setSaveDeleting] = useState(false);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [memberLoading, setMemberLoading] = useState(false);
  const [requesterQuery, setRequesterQuery] = useState("");
  const [selectedRequester, setSelectedRequester] = useState<MemberRow | null>(null);
  const [hostileClanName, setHostileClanName] = useState("");
  const [reason, setReason] = useState("");
  const [hostileAt, setHostileAt] = useState(() => toDatetimeLocalInput(new Date().toISOString()));

  const load = useCallback(async () => {
    if (!clanId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await getJSON<{ ok: boolean; items: HostileRow[] }>(`/v1/clans/${clanId}/hostiles`);
      const filtered = (res.items ?? []).filter((item) => !item.delYn || item.delYn === "N");
      setRows(filtered);
    } catch (e: any) {
      alert(e?.body?.message ?? e?.message ?? "적대 목록을 불러오지 못했습니다.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [clanId]);

  useEffect(() => {
    void load();
  }, [load]);

  const orderedRows = useMemo(() => rows.map((row, index) => ({ ...row, orderNo: index + 1 })), [rows]);
  const requesterCandidates = useMemo(() => {
    const q = requesterQuery.trim().toLowerCase();
    if (!q) return [] as MemberRow[];
    return members
      .filter((member) => member.loginId.toLowerCase().includes(q))
      .slice(0, 8);
  }, [members, requesterQuery]);
  const highlightedRequester = requesterCandidates[0] ?? null;

  const loadMembers = useCallback(async () => {
    if (!clanId || memberLoading || members.length > 0) return;
    setMemberLoading(true);
    try {
      const res = await postJSON<{ ok: true; members: MemberRow[]; count: number }>(
        `/v1/members/list?clanId=${encodeURIComponent(String(clanId))}`,
        {}
      );
      setMembers(res.members ?? []);
    } catch (e: any) {
      alert(e?.body?.message ?? e?.message ?? "혈맹원 목록을 불러오지 못했습니다.");
    } finally {
      setMemberLoading(false);
    }
  }, [clanId, memberLoading, members.length]);

  const resetCreateForm = () => {
    setRequesterQuery("");
    setSelectedRequester(null);
    setHostileClanName("");
    setReason("");
    setHostileAt(toDatetimeLocalInput(new Date().toISOString()));
  };

  const closeCreateModal = () => {
    if (saving) return;
    setCreateOpen(false);
    resetCreateForm();
  };

  const openCreateModal = () => {
    setCreateOpen(true);
    void loadMembers();
  };

  const submitCreate = async () => {
    if (!clanId) {
      alert("혈맹 정보가 없어 등록할 수 없습니다.");
      return;
    }
    if (!canManage) {
      alert("적대 등록 권한이 없습니다.");
      return;
    }
    const trimmedReason = reason.trim();
    const trimmedHostileClanName = hostileClanName.trim();
    if (!trimmedHostileClanName) {
      alert("적대 혈맹명을 입력해 주세요.");
      return;
    }
    if (!trimmedReason) {
      alert("적대 등록 사유를 입력해 주세요.");
      return;
    }
    if (!selectedRequester) {
      alert("요청자/등록자를 선택해 주세요.");
      return;
    }
    setSaving(true);
    try {
      await postJSON(`/v1/clans/${clanId}/hostiles`, {
        userId: Number(selectedRequester.id),
        hostileClanName: trimmedHostileClanName,
        reason: trimmedReason,
        hostileAt: hostileAt ? new Date(hostileAt).toISOString() : undefined,
      });
      closeCreateModal();
      await load();
    } catch (e: any) {
      alert(e?.body?.message ?? e?.message ?? "적대 등록에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const toggleChecked = (seq: number) => {
    setCheckedSeqs((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  };

  const enterDeleteMode = () => {
    if (!canManage) {
      alert("적대 삭제 권한이 없습니다.");
      return;
    }
    setDeleteMode(true);
    setCheckedSeqs(new Set());
  };

  const cancelDeleteMode = () => {
    if (saveDeleting) return;
    setDeleteMode(false);
    setCheckedSeqs(new Set());
  };

  const saveDelete = async () => {
    if (!clanId) {
      alert("혈맹 정보가 없어 삭제할 수 없습니다.");
      return;
    }
    if (checkedSeqs.size === 0) {
      alert("삭제할 적대를 선택해 주세요.");
      return;
    }
    setSaveDeleting(true);
    try {
      for (const seq of checkedSeqs) {
        await delJSON(`/v1/clans/${clanId}/hostiles/${seq}`);
      }
      cancelDeleteMode();
      await load();
    } catch (e: any) {
      alert(e?.body?.message ?? e?.message ?? "적대 삭제에 실패했습니다.");
    } finally {
      setSaveDeleting(false);
    }
  };

  if (!canManage) {
    return (
      <div className="space-y-6">
        <PageHeader title="적대관리" subtitle="간부, 관리자만 사용할 수 있습니다." />
        <Card>
          <div className="text-sm text-white/70">접근 권한이 없습니다.</div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="적대관리"
        subtitle="적대 목록 등록 및 삭제"
        right={
          <div className="flex items-center gap-2">
            {deleteMode ? (
              <>
                <button
                  type="button"
                  onClick={() => void saveDelete()}
                  disabled={saveDeleting}
                  className="px-3 py-2 rounded-xl bg-white/15 text-white hover:bg-white/20 disabled:opacity-60"
                >
                  {saveDeleting ? "저장 중..." : "저장"}
                </button>
                <button
                  type="button"
                  onClick={cancelDeleteMode}
                  disabled={saveDeleting}
                  className="px-3 py-2 rounded-xl border border-white/10 text-white/80 hover:bg-white/10 disabled:opacity-60"
                >
                  취소
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="px-3 py-2 rounded-xl bg-white/15 text-white hover:bg-white/20"
                >
                  적대 등록
                </button>
                <button
                  type="button"
                  onClick={enterDeleteMode}
                  className="px-3 py-2 rounded-xl border border-white/10 text-white/80 hover:bg-white/10"
                >
                  삭제
                </button>
              </>
            )}
          </div>
        }
      />

      <Card className="overflow-hidden">
        {loading ? (
          <div className="text-sm text-white/70">불러오는 중...</div>
        ) : orderedRows.length === 0 ? (
          <div className="text-sm text-white/70">등록된 적대 혈맹이 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-white/60">
                <tr className="border-b border-white/10">
                  <th className="px-3 py-3 text-left w-[90px]">순번</th>
                  <th className="px-3 py-3 text-left">혈맹명</th>
                  <th className="px-3 py-3 text-left">등록자/요청자</th>
                  <th className="px-3 py-3 text-left">등록일자</th>
                </tr>
              </thead>
              <tbody>
                {orderedRows.map((row) => (
                  <tr key={row.seq} className="border-b border-white/5 last:border-b-0">
                    <td className="px-3 py-3 text-white/90">
                      {deleteMode ? (
                        <input
                          type="checkbox"
                          checked={checkedSeqs.has(row.seq)}
                          onChange={() => toggleChecked(row.seq)}
                          className="h-4 w-4 accent-emerald-400"
                        />
                      ) : (
                        row.orderNo
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-white">{row.hostileClanName?.trim() || "-"}</div>
                      <div className="text-xs text-white/45 mt-1">{row.reason}</div>
                    </td>
                    <td className="px-3 py-3 text-white/80">{row.userLoginId?.trim() || "-"}</td>
                    <td className="px-3 py-3 text-white/80">{fmtDateTime(row.hostileAt || row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={createOpen}
        onClose={closeCreateModal}
        title="적대 등록"
        maxWidth="max-w-[560px]"
        footer={
          <>
            <button
              type="button"
              onClick={closeCreateModal}
              disabled={saving}
              className="px-3 py-2 rounded-xl border border-white/10 text-white/80 hover:bg-white/10 disabled:opacity-60"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => void submitCreate()}
              disabled={saving}
              className="px-3 py-2 rounded-xl bg-white/15 text-white hover:bg-white/20 disabled:opacity-60"
            >
              {saving ? "저장 중..." : "등록"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <div className="mb-2 text-sm text-white/70">적대 혈맹명</div>
            <input
              type="text"
              value={hostileClanName}
              onChange={(e) => setHostileClanName(e.currentTarget.value)}
              maxLength={100}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/40"
              placeholder="적대 혈맹명을 입력해 주세요."
            />
          </div>
          <div className="relative">
            <div className="mb-2 text-sm text-white/70">요청자/등록자</div>
            <input
              type="text"
              value={requesterQuery}
              onChange={(e) => {
                setRequesterQuery(e.currentTarget.value);
                if (selectedRequester && selectedRequester.loginId !== e.currentTarget.value) {
                  setSelectedRequester(null);
                }
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (selectedRequester && selectedRequester.loginId === requesterQuery.trim()) return;
                if (!highlightedRequester) {
                  alert("검색된 유저가 없습니다.");
                  return;
                }
                setSelectedRequester(highlightedRequester);
                setRequesterQuery(highlightedRequester.loginId);
              }}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/40"
              placeholder="아이디를 입력해 선택해 주세요."
            />
            {memberLoading && (
              <div className="mt-2 text-xs text-white/50">혈맹원 목록 불러오는 중...</div>
            )}
            {!!selectedRequester && (
              <div className="mt-2 text-xs text-emerald-300">
                선택됨: {selectedRequester.loginId}
              </div>
            )}
            {!selectedRequester && requesterCandidates.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-2 overflow-hidden rounded-xl border border-white/10 bg-slate-950/95 shadow-xl">
                {requesterCandidates.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => {
                      setSelectedRequester(member);
                      setRequesterQuery(member.loginId);
                    }}
                    className={`block w-full px-4 py-3 text-left text-sm ${
                      highlightedRequester?.id === member.id
                        ? "bg-white/10 text-white"
                        : "text-white/85 hover:bg-white/10"
                    }`}
                  >
                    {member.loginId}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="mb-2 text-sm text-white/70">적대 등록 사유</div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
              rows={4}
              maxLength={500}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/40"
              placeholder="적대 등록 사유를 입력해 주세요."
            />
          </div>
          <div>
            <div className="mb-2 text-sm text-white/70">적대 등록일자</div>
            <input
              type="datetime-local"
              value={hostileAt}
              onChange={(e) => setHostileAt(e.currentTarget.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
