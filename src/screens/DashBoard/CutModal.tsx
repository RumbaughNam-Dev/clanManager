import { useState, useEffect, useMemo, useRef } from "react";
import Modal from "../../components/common/Modal";
import { postJSON } from "@/lib/http";
import type { BossDto } from "../../types";
import { toIsoFromLocal, roleLabel } from "../../utils/util";
import { useAuth } from "@/contexts/AuthContext";
import DatePicker, { registerLocale } from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { ko } from "date-fns/locale";

registerLocale("ko", ko);

type MemberRow = {
  id: string;
  loginId: string;
  role: "SUPERADMIN" | "ADMIN" | "LEADER" | "USER";
  createdAt: string;
  timelineId?: string | null;
};

 type CutModalProps = {
   open: boolean;
   boss: { id: string; name: string } | null;   // ✅ 필요한 필드만
   onClose: () => void;
   onSaved: () => void;
   defaultCutAt: string;
   timelineId?: string | null; // 컷 수정 모드용 (없으면 컷 생성)
 };

type Mode = "DISTRIBUTE" | "TREASURY";

type ItemRow = {
  name: string;
  looterInput: string;   // 타이핑 표시용
  looterLoginId: string; // 확정값(없어도 됨)
};

export default function CutModal({
  open,
  boss,
  onClose,
  onSaved,
  defaultCutAt,
  timelineId
}: CutModalProps) {
  const { user } = useAuth();

  const [cutAtInput, setCutAtInput] = useState(defaultCutAt);
  const [mode, setMode] = useState<Mode>("DISTRIBUTE");

  const [rows, setRows] = useState<ItemRow[]>([
    { name: "", looterInput: "", looterLoginId: "" },
    { name: "", looterInput: "", looterLoginId: "" },
    { name: "", looterInput: "", looterLoginId: "" },
    { name: "", looterInput: "", looterLoginId: "" },
    { name: "", looterInput: "", looterLoginId: "" },
  ]);

  const [file, setFile] = useState<File | null>(null);
  const [fileNamePreview, setFileNamePreview] = useState<string | null>(null);

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [focusRowIdx, setFocusRowIdx] = useState<number | null>(null);
  const [activeSugIndex, setActiveSugIndex] = useState(0);
  const suggBoxRef = useRef<HTMLDivElement | null>(null);

  const [submitting, setSubmitting] = useState(false);

  const bossId = boss?.id ?? null;
  const didInitRef = useRef(false);
  const lastInitBossIdRef = useRef<string | null>(null);

  const isComposingRef = useRef(false);

  useEffect(() => {
    if (!open) {
      didInitRef.current = false;
      return;
    }
    if (!didInitRef.current || lastInitBossIdRef.current !== bossId) {
      setCutAtInput(defaultCutAt);
      setMode("DISTRIBUTE");
      setRows([
        { name: "", looterInput: "", looterLoginId: "" },
        { name: "", looterInput: "", looterLoginId: "" },
        { name: "", looterInput: "", looterLoginId: "" },
        { name: "", looterInput: "", looterLoginId: "" },
        { name: "", looterInput: "", looterLoginId: "" },
      ]);
      setFile(null);
      setFileNamePreview(null);
      setSelectedIds(new Set());
      setMemberSearch("");
      loadMembers();

      didInitRef.current = true;
      lastInitBossIdRef.current = bossId;
    }
  }, [open, bossId, defaultCutAt]);

  async function loadMembers() {
    try {
      const url = user?.clanId
        ? `/v1/members/list?clanId=${encodeURIComponent(user.clanId)}`
        : `/v1/members/list`;
      const r = await postJSON<{ ok: true; members: MemberRow[]; count?: number }>(url);
      setMembers(r.members || []);
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

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.loginId.toLowerCase().includes(q));
  }, [memberSearch, members]);

  const looterSuggestions = useMemo(() => {
    if (focusRowIdx == null) return [] as MemberRow[];
    const q = rows[focusRowIdx].looterInput.trim().toLowerCase();
    if (!q) return [];
    const rankRole = (r: MemberRow["role"]) =>
      r === "ADMIN" ? 0 : r === "LEADER" ? 1 : r === "SUPERADMIN" ? 2 : 3;
    return members
      .filter((m) => m.loginId.toLowerCase().includes(q))
      .sort((a, b) => {
        const ra = rankRole(a.role);
        const rb = rankRole(b.role);
        if (ra !== rb) return ra - rb;
        return a.loginId.localeCompare(b.loginId);
      })
      .slice(0, 8);
  }, [focusRowIdx, rows, members]);

  function chooseLooter(loginId: string) {
    if (focusRowIdx == null) return;
    setRows((prev) => {
      const next = [...prev];
      next[focusRowIdx] = {
        ...next[focusRowIdx],
        looterInput: loginId,
        looterLoginId: loginId,
      };
      return next;
    });
  }

  function onLooterKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!looterSuggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSugIndex((i) => Math.min(i + 1, looterSuggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSugIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = looterSuggestions[activeSugIndex];
      if (picked) {
        chooseLooter(picked.loginId);
        setFocusRowIdx(null);
      }
    }
  }

  function closeSuggestionWithDelay() {
    setTimeout(() => setFocusRowIdx(null), 120);
  }

  async function submitCut() {
    if (!boss && !timelineId) return;

    // 이미지 업로드
    const imageFileName = await uploadImageIfAny();

    const filled = rows.filter(r => r.name.trim());
    const itemsEx = filled.map(r => ({
      itemName: r.name.trim(),
      lootUserId: r.looterLoginId || null,
    }));
    const participants = Array.from(selectedIds);

    setSubmitting(true);
    try {
      if (timelineId) {
        // ✅ UPDATE 흐름
        const payload = {
          cutAtIso: toIsoFromLocal(cutAtInput),     // 수정 허용
          mode,
          itemsEx,                                   // 전체 스냅샷
          participants,
          imageFileName,
        };
        await postJSON(`/v1/dashboard/boss-timelines/${timelineId}`, payload);
      } else {
        // 기존 CREATE 흐름
        const payload = {
          cutAtIso: toIsoFromLocal(cutAtInput),
          looterLoginId: null,
          items: filled.map(r => r.name.trim()),
          itemsEx,
          mode,
          participants,
          imageFileName,
        };
        await postJSON(`/v1/dashboard/bosses/${boss!.id}/cut`, payload);
      }
      onSaved();
    } catch (e: any) {
      alert(e?.message ?? "저장 실패");
    } finally {
      setSubmitting(false);
    }
  }

  function handleMemberQuickPickKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;

    // 🔒 IME 조합 중 Enter는 무시 (한글 '울대' 같은 케이스)
    // 일부 브라우저는 keyCode 229, React nativeEvent.isComposing도 제공
    // @ts-ignore
    const composing = (e.nativeEvent && (e.nativeEvent as any).isComposing) || isComposingRef.current;
    // @ts-ignore
    const isIME229 = (e as any).which === 229 || (e as any).keyCode === 229;
    if (composing || isIME229) return;

    e.preventDefault();

    // ✅ 상태값(memberSearch) 말고 현재 input의 최신 값 사용
    const inputEl = e.currentTarget as HTMLInputElement;
    const q = inputEl.value.trim();
    if (!q) return;

    // 정확 아이디 일치
    const found = members.find((m) => m.loginId === q);
    if (!found) {
      alert("등록되지 않은 혈맹원 입니다.");
      return;
    }

    setSelectedIds((prev) => {
      if (prev.has(found.loginId)) return prev;
      const next = new Set(prev);
      next.add(found.loginId);
      return next;
    });

    // 입력창 정리
    setMemberSearch("");
    inputEl.value = "";   // 즉시 비우기 (state 반영 기다리지 않음)
    // ✅ 포커스 유지: 비운 뒤 바로 다시 포커스 & 캐럿 맨 끝
    requestAnimationFrame(() => {
      inputEl.focus();
      try { inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length); } catch {}
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={boss ? `${boss.name} 컷 기록` : "컷 기록"}
      maxWidth="max-w-4xl"
      footer={
        <>
          <button className="px-3 py-2 rounded-lg border hover:bg-slate-50" onClick={onClose} disabled={submitting}>
            취소
          </button>
          <button
            className={`px-3 py-2 rounded-lg ${submitting ? "bg-gray-200 text-gray-500" : "bg-slate-900 text-white"}`}
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
          {/* 컷 시간 */}
          <div>
            <label className="block text-sm mb-1">컷 시간</label>
            <DatePicker
              selected={new Date(cutAtInput)}
              locale="ko"
              onChange={(date: Date | null) => {
                if (date) setCutAtInput(date.toString());
              }}
              showTimeSelect
              timeIntervals={1}
              dateFormat="yyyy-MM-dd HH:mm:ss"
              className="w-full border rounded-lg px-3 py-2"
            />
          </div>

          {/* 아이템×루팅자 5줄 */}
          <div className="space-y-2">
            <div className="text-sm font-medium">루팅 아이템 / 루팅자 (최대 5개, 루팅자 생략 가능)</div>
            {rows.map((row, idx) => (
              <div key={idx} className="grid grid-cols-5 gap-2">
                <input
                  className="col-span-3 border rounded-lg px-3 py-2"
                  placeholder={`아이템 #${idx + 1}`}
                  value={row.name}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRows((prev) => {
                      const next = [...prev];
                      next[idx] = { ...next[idx], name: v };
                      return next;
                    });
                  }}
                />
                <div className="col-span-2 relative">
                  <input
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="루팅자 아이디(선택)"
                    value={row.looterInput}
                    onFocus={() => { setFocusRowIdx(idx); setActiveSugIndex(0); }}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRows((prev) => {
                        const next = [...prev];
                        next[idx] = { ...next[idx], looterInput: v, looterLoginId: "" }; // 타이핑 시 확정 해제
                        return next;
                      });
                    }}
                    onKeyDown={onLooterKeyDown}
                    onBlur={closeSuggestionWithDelay}
                  />
                  {focusRowIdx === idx && row.looterInput.trim() && (
                    <div
                      ref={suggBoxRef}
                      className="absolute left-0 right-0 mt-1 max-h-48 overflow-auto border rounded-lg bg-white shadow z-10"
                    >
                      {looterSuggestions.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-slate-500">결과 없음</div>
                      ) : (
                        looterSuggestions.map((m, i) => (
                          <div
                            key={m.id}
                            className={`px-3 py-2 text-sm cursor-pointer ${i === activeSugIndex ? "bg-slate-100" : "bg-white hover:bg-slate-50"}`}
                            onMouseDown={(ev) => ev.preventDefault()}
                            onClick={() => { chooseLooter(m.loginId); setFocusRowIdx(null); }}
                          >
                            <span className="font-medium">{m.loginId}</span>
                            <span className="ml-2 text-xs text-slate-500">({roleLabel(m.role)})</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <p className="text-xs text-gray-500">
              루팅자는 선택 사항입니다. 자동완성에서 고르면 확정되고, 비워둬도 저장됩니다.
            </p>
          </div>

          <div>
            <label className="block text-sm mb-1">정산 방식</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode("DISTRIBUTE")}
                className={`px-3 py-2 rounded-lg border text-sm ${mode === "DISTRIBUTE" ? "bg-slate-900 text-white" : "hover:bg-slate-50"}`}
              >
                분배
              </button>
              <button
                type="button"
                onClick={() => setMode("TREASURY")}
                className={`px-3 py-2 rounded-lg border text-sm ${mode === "TREASURY" ? "bg-slate-900 text-white" : "hover:bg-slate-50"}`}
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
            {fileNamePreview && <p className="mt-1 text-xs text-slate-500">선택된 파일: {fileNamePreview}</p>}
          </div>
        </div>

        {/* 우측: 참여자 */}
        <div className="space-y-3">
          <div>
            <label className="block text-sm mb-1">참여자 입력 (Enter로 체크)</label>
            <input
              className="w-full border rounded-lg px-3 py-2"
              placeholder="아이디 입력 후 Enter로 체크"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              onKeyDown={handleMemberQuickPickKeyDown}
              onCompositionStart={() => { isComposingRef.current = true; }}
              onCompositionEnd={(e) => {
                isComposingRef.current = false;
                // 조합이 끝난 최종 문자열을 상태에 반영(선택)
                setMemberSearch((e.currentTarget as HTMLInputElement).value);
              }}
            />
          </div>

          <div className="border rounded-lg p-2 h-72 overflow-y-auto">
            {filteredMembers.length === 0 ? (
              <div className="text-sm text-slate-500 px-1 py-2">검색 결과가 없습니다.</div>
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
                      <label htmlFor={`mem-${m.id}`} className="text-sm">
                        {m.loginId} <span className="text-xs text-slate-400">({roleLabel(m.role)})</span>
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