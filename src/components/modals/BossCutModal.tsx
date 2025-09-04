// src/components/modals/BossCutModal.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { postJSON } from "@/lib/http";

type Props = {
  boss: { id: string; name: string };
  onClose: () => void;
  onSaved: () => void;
};

type Mode = "DISTRIBUTE" | "TREASURY";

type MemberRow = {
  id: string;
  loginId: string;
  role: "SUPERADMIN" | "ADMIN" | "LEADER" | "USER";
};

type Row = {
  item: string;
  looterInput: string;     // 타이핑 값(자동완성 선택 안 해도 이 값이 그대로 전송)
  looterSelected: string;  // 자동완성으로 확정된 값(있으면 우선)
  isComposing?: boolean;   // 한글/IME 조합 입력 상태
};

const MAX_ROWS = 5;

export default function BossCutModal({ boss, onClose, onSaved }: Props) {
  // 5줄: 아이템 + 루팅자
  const [rows, setRows] = useState<Row[]>(
    Array.from({ length: MAX_ROWS }, () => ({ item: "", looterInput: "", looterSelected: "", isComposing: false }))
  );

  const [mode, setMode] = useState<Mode>("DISTRIBUTE");
  const [participantsText, setParticipantsText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  // 자동완성 제어 상태
  const [focusRow, setFocusRow] = useState<number | null>(null);
  const [activeSugIdx, setActiveSugIdx] = useState(0);
  const sugBoxRef = useRef<HTMLDivElement | null>(null);

  // 멤버 목록
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [memLoading, setMemLoading] = useState(false);
  const [memErr, setMemErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setMemLoading(true);
        const r = await postJSON<{ ok: true; members: MemberRow[]; count: number }>("/v1/members/list");
        setMembers(r.members || []);
      } catch (e: any) {
        setMemErr(e?.message ?? "멤버 목록을 불러오지 못했습니다.");
      } finally {
        setMemLoading(false);
      }
    })();
  }, []);

  // 참여자 파싱
  const participants = useMemo(
    () => participantsText.split(",").map((s) => s.trim()).filter(Boolean),
    [participantsText]
  );

  // 자동완성 후보(현재 포커스 줄 기준)
  const looterSuggestions = useMemo(() => {
    if (focusRow == null) return [] as MemberRow[];
    const q = rows[focusRow]?.looterInput.trim().toLowerCase() ?? "";
    if (!q) return [] as MemberRow[];
    const rank = (r: MemberRow["role"]) =>
      r === "ADMIN" ? 0 : r === "LEADER" ? 1 : r === "SUPERADMIN" ? 2 : 3;
    return members
      .filter((m) => m.loginId.toLowerCase().includes(q))
      .sort((a, b) => {
        const ra = rank(a.role), rb = rank(b.role);
        if (ra !== rb) return ra - rb;
        return a.loginId.localeCompare(b.loginId);
      })
      .slice(0, 8);
  }, [focusRow, rows, members]);

  // 자동완성 확정
  function chooseLooter(rowIdx: number, loginId: string) {
    setRows(prev => {
      const next = [...prev];
      next[rowIdx] = { ...next[rowIdx], looterSelected: loginId, looterInput: loginId };
      return next;
    });
  }

  // ↑/↓/Enter
  function onLooterKeyDown(e: React.KeyboardEvent<HTMLInputElement>, rowIdx: number) {
    if (!looterSuggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSugIdx(i => Math.min(i + 1, looterSuggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSugIdx(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      // 조합 입력 중 Enter는 확정용이니 막지 않음
      const isComp = rows[rowIdx]?.isComposing;
      if (!isComp) {
        e.preventDefault();
        const picked = looterSuggestions[activeSugIdx];
        if (picked) chooseLooter(rowIdx, picked.loginId);
        setFocusRow(null);
      }
    }
  }

  // blur 후 살짝 지연 닫기(클릭 선택 허용)
  function closeSuggestionWithDelay() {
    setTimeout(() => setFocusRow(null), 120);
  }

  // (1) 이미지가 있으면 먼저 업로드해서 fileName 획득
  async function uploadImageIfAny(): Promise<string | undefined> {
    if (!image) return undefined;
    const API_BASE =
      (import.meta as any)?.env?.VITE_API_BASE ?? "http://localhost:3000";
    const url = `${API_BASE.replace(/\/+$/, "")}/v1/dashboard/bosses/${boss.id}/cut/upload`;

    const fd = new FormData();
    fd.append("file", image);

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

  // 제출
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    // 아이템 입력된 줄만 남김(인덱스 뒤틀림 방지)
    const filledRows = rows.filter(r => r.item.trim().length > 0);

    // 분배 모드일 때만 참여자 필수
    if (filledRows.length > 0 && mode === "DISTRIBUTE" && participants.length === 0) {
      alert("분배를 선택한 경우 참여자 아이디를 입력하세요.");
      return;
    }

    // 조합 입력 중이면 먼저 확정
    const normalized = filledRows.map(r => {
      const lootUserTyped = (r.looterSelected || r.looterInput || "").trim();
      return {
        name: r.item.trim(),
        lootUserId: lootUserTyped === "" ? null : lootUserTyped, // 빈문자 → null
      };
    });

    setSaving(true);
    try {
      const imageFileName = await uploadImageIfAny();

      // 레거시 호환 필드
      const lootItems = normalized.map(n => n.name);
      const lootUsers = normalized.map(n => n.lootUserId ?? "");
      const firstLooter = lootUsers.find(s => s.length > 0) || null;

      // 디버그 로그 (Console 탭에서 rows / payload 확인)
      console.log("[BossCutModal] rows =", rows);
      console.log("[BossCutModal] payload =", {
        // cutAtIso는 서버에서 저장시간 사용(필요시 추가)
        looterLoginId: firstLooter,
        items: lootItems,
        lootUsers,
        itemsEx: normalized,      // ✅ { name, lootUserId }
        mode,
        participants,
        imageFileName,
      });

      await postJSON(`/v1/dashboard/bosses/${boss.id}/cut`, {
        looterLoginId: firstLooter, // 레거시
        items: lootItems,           // 레거시
        lootUsers,                  // 레거시-인덱스 호환
        itemsEx: normalized,        // ✅ 권장: { name, lootUserId }
        mode,
        participants,
        imageFileName,
      });

      onSaved();
    } catch (err: any) {
      alert(err?.message ?? "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* overlay */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      {/* modal */}
      <form
        onSubmit={onSubmit}
        className="relative w-[760px] max-w-[95vw] bg-white rounded-2xl shadow-xl p-5 space-y-4"
      >
        <div className="text-lg font-bold">보스 컷 기록 · {boss.name}</div>

        {/* 5줄: 아이템 + 루팅자 */}
        <div className="space-y-2">
          <div className="text-sm font-medium">루팅 아이템 / 루팅자 (최대 5개)</div>

          {rows.map((r, idx) => (
            <div key={idx} className="grid grid-cols-5 gap-2">
              {/* 아이템명 */}
              <input
                className="col-span-3 border rounded-lg px-3 py-2"
                placeholder={`아이템 #${idx + 1}`}
                value={r.item}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setRows(prev => {
                    const next = [...prev];
                    next[idx] = { ...next[idx], item: v };
                    return next;
                  });
                }}
              />

              {/* 루팅자 입력/검색(줄별) */}
              <div className="col-span-2 relative">
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="루팅자 아이디 입력/검색"
                  value={r.looterInput}
                  onFocus={() => { setFocusRow(idx); setActiveSugIdx(0); }}
                  onCompositionStart={() => {
                    setRows(prev => {
                      const next = [...prev];
                      next[idx] = { ...next[idx], isComposing: true };
                      return next;
                    });
                  }}
                  onCompositionEnd={(e) => {
                    const v = (e.target as HTMLInputElement).value;
                    setRows(prev => {
                      const next = [...prev];
                      next[idx] = { ...next[idx], looterInput: v, isComposing: false };
                      return next;
                    });
                  }}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    setRows(prev => {
                      const next = [...prev];
                      // 자동완성 선택 안 해도 전송되도록 입력값을 유지
                      next[idx] = { ...next[idx], looterInput: v, looterSelected: "" };
                      return next;
                    });
                  }}
                  onKeyDown={(e) => onLooterKeyDown(e, idx)}
                  onBlur={closeSuggestionWithDelay}
                />

                {/* 자동완성 */}
                {focusRow === idx && r.looterInput.trim() && (
                  <div
                    ref={sugBoxRef}
                    className="absolute left-0 right-0 mt-1 max-h-48 overflow-auto border rounded-lg bg-white shadow z-10"
                  >
                    {memLoading ? (
                      <div className="px-3 py-2 text-sm text-slate-500">불러오는 중…</div>
                    ) : memErr ? (
                      <div className="px-3 py-2 text-sm text-rose-600">{memErr}</div>
                    ) : looterSuggestions.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-slate-500">결과 없음</div>
                    ) : (
                      looterSuggestions.map((m, i) => (
                        <div
                          key={m.id}
                          className={`px-3 py-2 text-sm cursor-pointer ${
                            i === activeSugIdx ? "bg-slate-100" : "bg-white hover:bg-slate-50"
                          }`}
                          onMouseDown={(ev) => ev.preventDefault()}
                          onClick={() => {
                            chooseLooter(idx, m.loginId);
                            setFocusRow(null);
                          }}
                          title={
                            m.role === "ADMIN" ? "관리자" :
                            m.role === "LEADER" ? "간부" :
                            m.role === "SUPERADMIN" ? "슈퍼관리자" : "혈맹원"
                          }
                        >
                          <span className="font-medium">{m.loginId}</span>
                          <span className="ml-2 text-xs text-slate-500">
                            {m.role === "ADMIN" ? "관리자" :
                             m.role === "LEADER" ? "간부" :
                             m.role === "SUPERADMIN" ? "슈퍼관리자" : "혈맹원"}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* 선택 안내(선택했을 때만 노출) */}
                {r.looterSelected && (
                  <div className="mt-1 text-xs text-emerald-700">
                    선택됨: <span className="font-semibold">{r.looterSelected}</span>
                  </div>
                )}
              </div>
            </div>
          ))}

          <p className="text-xs text-gray-500">
            아이템만 입력해도 저장됩니다. 루팅자는 <b>자동완성 선택 없이 타이핑만 해도 전송</b>돼요.
          </p>
        </div>

        {/* 처리 방식 / 참여자 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">처리 방식</label>
            <div className="flex gap-2">
              <label className={`px-3 py-2 rounded-lg border cursor-pointer ${mode === "DISTRIBUTE" ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-50"}`}>
                <input type="radio" name="mode" value="DISTRIBUTE" className="hidden" checked={mode === "DISTRIBUTE"} onChange={() => setMode("DISTRIBUTE")} />
                분배
              </label>
              <label className={`px-3 py-2 rounded-lg border cursor-pointer ${mode === "TREASURY" ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-50"}`}>
                <input type="radio" name="mode" value="TREASURY" className="hidden" checked={mode === "TREASURY"} onChange={() => setMode("TREASURY")} />
                혈비 귀속
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">참여자(아이디, 콤마로 구분)</label>
            <input
              className="w-full border rounded-lg px-3 py-2"
              placeholder="예: expoool,uldae,alpha"
              value={participantsText}
              onChange={(e) => setParticipantsText(e.target.value)}
            />
            <p className="text-xs text-gray-500 mt-1">
              분배를 선택한 경우 필수. 아이디 사이를 <span className="font-medium">콤마(,)</span>로 구분합니다.
            </p>
          </div>
        </div>

        {/* 캡쳐 이미지 */}
        <div>
          <label className="block text-sm font-medium mb-1">캡쳐 이미지 (선택)</label>
          <input type="file" accept="image/*" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
        </div>

        {/* 액션 */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border bg-white hover:bg-slate-50">
            취소
          </button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl bg-slate-900 text-white disabled:opacity-50">
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </form>
    </div>
  );
}