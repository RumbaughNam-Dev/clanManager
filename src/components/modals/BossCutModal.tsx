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

export default function BossCutModal({ boss, onClose, onSaved }: Props) {
  // 아이템 입력칸 5개
  const [lootInputs, setLootInputs] = useState<string[]>(["", "", "", "", ""]);

  // 루팅자(자동완성): 화면 입력값 / 확정 선택값 분리
  const [looterInput, setLooterInput] = useState("");
  const [looterLoginId, setLooterLoginId] = useState("");

  const [mode, setMode] = useState<Mode>("DISTRIBUTE");
  const [participantsText, setParticipantsText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  // 자동완성 동작 관련 상태
  const [focusRow, setFocusRow] = useState<number | null>(null); // 어떤 줄에서 자동완성 열렸는지
  const [activeSugIdx, setActiveSugIdx] = useState(0);
  const sugBoxRef = useRef<HTMLDivElement | null>(null);

  // 멤버 목록: 1회 로드 후 클라에서 LIKE 필터
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

  // 파싱 결과
  const lootItems = useMemo(
    () => lootInputs.map((s) => s.trim()).filter(Boolean),
    [lootInputs]
  );
  const participants = useMemo(
    () => participantsText.split(",").map((s) => s.trim()).filter(Boolean),
    [participantsText]
  );

  // 자동완성 후보
  const looterSuggestions = useMemo(() => {
    const q = looterInput.trim().toLowerCase();
    if (!q) return [] as MemberRow[];
    const roleRank = (r: MemberRow["role"]) =>
      r === "ADMIN" ? 0 : r === "LEADER" ? 1 : r === "SUPERADMIN" ? 2 : 3;
    return members
      .filter((m) => m.loginId.toLowerCase().includes(q))
      .sort((a, b) => {
        const ra = roleRank(a.role);
        const rb = roleRank(b.role);
        if (ra !== rb) return ra - rb;
        return a.loginId.localeCompare(b.loginId);
      })
      .slice(0, 8);
  }, [looterInput, members]);

  // 검증
  const validationError = useMemo(() => {
    if (lootItems.length > 0) {
      if (!looterLoginId) return "루팅 아이디를 선택하세요.";
      if (mode === "DISTRIBUTE" && participants.length === 0)
        return "분배를 선택한 경우 참여자 아이디를 입력하세요.";
    }
    return null;
  }, [lootItems, looterLoginId, mode, participants]);

  // 루팅자 선택(확정)
  function chooseLooter(loginId: string) {
    setLooterLoginId(loginId);
    setLooterInput(loginId); // 입력칸에 반영
  }

  // 키보드 탐색
  function onLooterKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!looterSuggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSugIdx((i) => Math.min(i + 1, looterSuggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSugIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = looterSuggestions[activeSugIdx];
      if (picked) chooseLooter(picked.loginId);
      setFocusRow(null);
    }
  }

  // blur 시 자동완성 박스 닫기(클릭 선택 허용 위해 약간 지연)
  function closeSuggestionWithDelay() {
    setTimeout(() => setFocusRow(null), 120);
  }

  // 제출
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (validationError) {
      alert(validationError);
      return;
    }

    setSaving(true);
    try {
      const form = new FormData();
      form.append(
        "payload",
        JSON.stringify({
          lootItems, // string[]
          looterLoginId: looterLoginId || null, // 선택값
          mode, // "DISTRIBUTE" | "TREASURY"
          participants, // string[]
        })
      );
      if (image) form.append("image", image);

      const url = `/v1/dashboard/bosses/${boss.id}/cut`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          // FormData는 Content-Type 지정 금지(boundary 자동)
          Authorization: (() => {
            try {
              return `Bearer ${localStorage.getItem("accessToken") ?? ""}`;
            } catch {
              return "";
            }
          })(),
        } as any,
        body: form,
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText} :: ${txt}`);
      }
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
        className="relative w-[720px] max-w-[95vw] bg-white rounded-2xl shadow-xl p-5 space-y-4"
      >
        <div className="text-lg font-bold">보스 컷 기록 · {boss.name}</div>

        {/* 루팅 아이템(5개) + 루팅자 검색(공유) */}
        <div className="space-y-2">
          <div className="text-sm font-medium">루팅 아이템 (최대 5개)</div>

          {lootInputs.map((val, idx) => (
            <div key={idx} className="grid grid-cols-5 gap-2">
              {/* 아이템명 */}
              <input
                className="col-span-3 border rounded-lg px-3 py-2"
                placeholder={`아이템 #${idx + 1}`}
                value={val}
                onChange={(e) => {
                  const next = [...lootInputs];
                  next[idx] = e.target.value;
                  setLootInputs(next);
                }}
              />

              {/* 루팅자 검색(공유 입력칸) */}
              <div className="col-span-2 relative">
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="루팅자 아이디 검색"
                  value={looterInput}
                  onFocus={() => {
                    setFocusRow(idx);
                    setActiveSugIdx(0);
                  }}
                  onChange={(e) => {
                    setLooterInput(e.target.value);
                    setLooterLoginId(""); // 새로 타이핑하면 확정 해제
                  }}
                  onKeyDown={onLooterKeyDown}
                  onBlur={closeSuggestionWithDelay}
                />
                {/* 자동완성 드롭다운 */}
                {focusRow === idx && looterInput.trim() && (
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
                            chooseLooter(m.loginId);
                            setFocusRow(null);
                          }}
                          title={
                            m.role === "ADMIN" ? "관리자" : m.role === "LEADER" ? "간부" : m.role === "SUPERADMIN" ? "슈퍼관리자" : "혈맹원"
                          }
                        >
                          <span className="font-medium">{m.loginId}</span>
                          <span className="ml-2 text-xs text-slate-500">
                            {m.role === "ADMIN"
                              ? "관리자"
                              : m.role === "LEADER"
                              ? "간부"
                              : m.role === "SUPERADMIN"
                              ? "슈퍼관리자"
                              : "혈맹원"}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          <p className="text-xs text-gray-500">
            아이템이 없으면 비워두세요. (루팅자는 아이템이 1개 이상일 때 필수)
          </p>
          {looterLoginId && (
            <p className="text-xs text-emerald-700">
              선택된 루팅자: <span className="font-semibold">{looterLoginId}</span>
            </p>
          )}
        </div>

        {/* 처리 방식 / 참여자 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">처리 방식</label>
            <div className="flex gap-2">
              <label
                className={`px-3 py-2 rounded-lg border cursor-pointer ${
                  mode === "DISTRIBUTE" ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-50"
                }`}
              >
                <input
                  type="radio"
                  name="mode"
                  value="DISTRIBUTE"
                  className="hidden"
                  checked={mode === "DISTRIBUTE"}
                  onChange={() => setMode("DISTRIBUTE")}
                />
                분배
              </label>
              <label
                className={`px-3 py-2 rounded-lg border cursor-pointer ${
                  mode === "TREASURY" ? "bg-slate-900 text-white" : "bg-white hover:bg-slate-50"
                }`}
              >
                <input
                  type="radio"
                  name="mode"
                  value="TREASURY"
                  className="hidden"
                  checked={mode === "TREASURY"}
                  onChange={() => setMode("TREASURY")}
                />
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