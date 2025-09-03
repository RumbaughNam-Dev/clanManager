// src/screens/dashboard/CutModal.tsx
import { useState, useEffect, useMemo } from "react";
import Modal from "../../components/common/Modal";
import { postJSON } from "@/lib/http";
import type { BossDto } from "../../types";
import { toIsoFromLocal, roleLabel } from "../../utils/util";

type MemberRow = {
  id: string;
  loginId: string;
  role: "SUPERADMIN" | "ADMIN" | "LEADER" | "USER";
  createdAt: string;
};

type CutModalProps = {
  open: boolean;
  boss: BossDto | null;
  onClose: () => void;
  onSaved: () => void;
  defaultCutAt: string;
};

export default function CutModal({
  open,
  boss,
  onClose,
  onSaved,
  defaultCutAt,
}: CutModalProps) {
  const [cutAtInput, setCutAtInput] = useState(defaultCutAt);
  const [looterLoginId, setLooterLoginId] = useState("");
  const [mode, setMode] = useState<"DISTRIBUTE" | "TREASURY">("DISTRIBUTE");
  const [itemsText, setItemsText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileNamePreview, setFileNamePreview] = useState<string | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && boss) {
      // 초기화
      setCutAtInput(defaultCutAt);
      setLooterLoginId("");
      setMode("DISTRIBUTE");
      setItemsText("");
      setFile(null);
      setFileNamePreview(null);
      setSelectedIds(new Set());
      setMemberSearch("");
      loadMembers();
    }
  }, [open, boss]);

  async function loadMembers() {
    try {
      const r = await postJSON<{ ok: true; members: MemberRow[] }>("/v1/members");
      if (!r.ok) throw new Error("멤버 목록 조회 실패");
      setMembers(r.members);
    } catch (e: any) {
      alert(e?.message ?? "혈맹원 목록 조회 실패");
    }
  }

  async function uploadImageIfAny(): Promise<string | undefined> {
    if (!file || !boss) return undefined;
    const API_BASE =
      (import.meta as any)?.env?.VITE_API_BASE ?? "http://localhost:3000";
    const url = `${API_BASE.replace(/\/+$/, "")}/v1/dashboard/bosses/${boss.id}/cut/upload`;

    const fd = new FormData();
    fd.append("file", file);

    const headers: Record<string, string> = {};
    const t = typeof localStorage !== "undefined" ? localStorage.getItem("accessToken") : null;
    if (t) headers["Authorization"] = `Bearer ${t}`;

    const res = await fetch(url, { method: "POST", headers, body: fd });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`이미지 업로드 실패 (${res.status}): ${txt || res.statusText}`);
    }
    const json = await res.json();
    if (!json?.ok || !json?.fileName) throw new Error("이미지 업로드 응답이 올바르지 않습니다.");
    return json.fileName as string;
  }

  async function submitCut() {
    if (!boss) return;

    const items = itemsText
      .split(/[\n,]/g)
      .map((s) => s.trim())
      .filter(Boolean);

    const participants = Array.from(selectedIds);

    if (items.length > 0 && !looterLoginId) {
      alert("루팅 아이템이 있으면 루팅자(ID)는 필수입니다.");
      return;
    }
    if (items.length > 0 && mode === "DISTRIBUTE" && participants.length === 0) {
      alert("분배 모드에서는 참여자를 1명 이상 선택해야 합니다.");
      return;
    }

    setSubmitting(true);
    try {
      const imageFileName = await uploadImageIfAny();
      await postJSON(`/v1/dashboard/bosses/${boss.id}/cut`, {
        cutAtIso: toIsoFromLocal(cutAtInput),
        looterLoginId: looterLoginId || null,
        items,
        mode,
        participants,
        imageFileName,
      });

      onSaved();
    } catch (e: any) {
      alert(e?.message ?? "컷 저장 실패");
    } finally {
      setSubmitting(false);
    }
  }

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.loginId.toLowerCase().includes(q));
  }, [memberSearch, members]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={boss ? `${boss.name} 컷 기록` : "컷 기록"}
      maxWidth="max-w-4xl"
      footer={
        <>
          <button
            className="px-3 py-2 rounded-lg border hover:bg-slate-50"
            onClick={onClose}
            disabled={submitting}
          >
            취소
          </button>
          <button
            className={`px-3 py-2 rounded-lg ${
              submitting ? "bg-gray-200 text-gray-500" : "bg-slate-900 text-white"
            }`}
            onClick={submitCut}
            disabled={submitting}
          >
            {submitting ? "저장 중..." : "저장"}
          </button>
        </>
      }
    >
      <div className="grid md:grid-cols-2 gap-6">
        {/* 좌측 */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm mb-1">컷 시간</label>
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={cutAtInput}
              onChange={(e) => setCutAtInput(e.target.value)}
              placeholder="YYYY-MM-DD HH:mm:ss"
            />
          </div>

          <div>
            <label className="block text-sm mb-1">루팅 아이템</label>
            <textarea
              className="w-full border rounded-lg px-3 py-2 h-24"
              value={itemsText}
              onChange={(e) => setItemsText(e.target.value)}
              placeholder="예) 귀걸이 +7, 보라돌이반지"
            />
          </div>

          <div>
            <label className="block text-sm mb-1">루팅자 ID</label>
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={looterLoginId}
              onChange={(e) => setLooterLoginId(e.target.value)}
              placeholder="예) expoool"
            />
          </div>

          <div>
            <label className="block text-sm mb-1">정산 방식</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode("DISTRIBUTE")}
                className={`px-3 py-2 rounded-lg border text-sm ${
                  mode === "DISTRIBUTE"
                    ? "bg-slate-900 text-white"
                    : "hover:bg-slate-50"
                }`}
              >
                분배
              </button>
              <button
                type="button"
                onClick={() => setMode("TREASURY")}
                className={`px-3 py-2 rounded-lg border text-sm ${
                  mode === "TREASURY"
                    ? "bg-slate-900 text-white"
                    : "hover:bg-slate-50"
                }`}
              >
                혈비 귀속
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm mb-1">캡쳐 이미지 (선택)</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0] ?? null;
                setFile(f);
                setFileNamePreview(f ? f.name : null);
              }}
              className="block w-full text-sm"
            />
            {fileNamePreview && (
              <p className="mt-1 text-xs text-slate-500">
                선택된 파일: {fileNamePreview}
              </p>
            )}
          </div>
        </div>

        {/* 우측 */}
        <div className="space-y-3">
          <div>
            <label className="block text-sm mb-1">참여자 검색</label>
            <input
              className="w-full border rounded-lg px-3 py-2"
              placeholder="아이디 검색"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
            />
          </div>

          <div className="border rounded-lg p-2 h-72 overflow-y-auto">
            {filteredMembers.length === 0 ? (
              <div className="text-sm text-slate-500 px-1 py-2">
                검색 결과가 없습니다.
              </div>
            ) : (
              <ul className="space-y-1">
                {filteredMembers.map((m) => {
                  const checked = selectedIds.has(m.loginId);
                  return (
                    <li key={m.id} className="flex items-center gap-2">
                      <input
                        id={`mem-${m.id}`}
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = new Set(selectedIds);
                          if (e.currentTarget.checked) next.add(m.loginId);
                          else next.delete(m.loginId);
                          setSelectedIds(next);
                        }}
                      />
                      <label
                        htmlFor={`mem-${m.id}`}
                        className="text-sm"
                      >
                        {m.loginId}{" "}
                        <span className="text-xs text-slate-400">
                          ({roleLabel(m.role)})
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}