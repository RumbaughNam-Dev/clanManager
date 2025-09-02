import React, { useMemo, useState } from "react";

type Props = {
  boss: { id: string; name: string };
  onClose: () => void;
  onSaved: () => void;
};

type Mode = "DISTRIBUTE" | "TREASURY";

export default function BossCutModal({ boss, onClose, onSaved }: Props) {
  // 입력 상태
  const [lootItemsText, setLootItemsText] = useState(""); // 줄바꿈 기준 N개
  const [looterLoginId, setLooterLoginId] = useState("");
  const [mode, setMode] = useState<Mode>("DISTRIBUTE");
  const [participantsText, setParticipantsText] = useState(""); // 콤마로 구분
  const [image, setImage] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  // 파싱
  const lootItems = useMemo(
    () => lootItemsText.split(/\r?\n/).map(s => s.trim()).filter(Boolean),
    [lootItemsText]
  );
  const participants = useMemo(
    () => participantsText.split(",").map(s => s.trim()).filter(Boolean),
    [participantsText]
  );

  // 검증 규칙
  const validationError = useMemo(() => {
    if (lootItems.length > 0) {
      if (!looterLoginId) return "루팅 아이디를 입력하세요.";
      if (mode === "DISTRIBUTE" && participants.length === 0) return "분배를 선택한 경우 참여자 아이디를 입력하세요.";
    }
    return null;
  }, [lootItems, looterLoginId, mode, participants]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (validationError) { alert(validationError); return; }

    setSaving(true);
    try {
      const form = new FormData();
      form.append("payload", JSON.stringify({
        lootItems,             // string[]
        looterLoginId: looterLoginId || null,
        mode,                  // "DISTRIBUTE" | "TREASURY"
        participants,          // string[]
      }));
      if (image) form.append("image", image);

      const url = `/v1/dashboard/bosses/${boss.id}/cut`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          // FormData 사용할 때는 Content-Type을 직접 지정하지 말 것 (브라우저가 boundary 붙임)
          Authorization: (() => {
            try { return `Bearer ${localStorage.getItem("accessToken") ?? ""}`; } catch { return ""; }
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
        className="relative w-[680px] max-w-[95vw] bg-white rounded-2xl shadow-xl p-5 space-y-4"
      >
        <div className="text-lg font-bold">보스 컷 기록 · {boss.name}</div>

        {/* 루팅 아이템 */}
        <div>
          <label className="block text-sm font-medium mb-1">루팅 아이템 (줄바꿈으로 여러 개)</label>
          <textarea
            className="w-full border rounded-lg px-3 py-2 h-28"
            placeholder={"예)\n영웅제작서\n빛나는갑옷"}
            value={lootItemsText}
            onChange={(e) => setLootItemsText(e.target.value)}
          />
          <p className="text-xs text-gray-500 mt-1">없으면 비워두세요.</p>
        </div>

        {/* 루팅자 / 분배 방식 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">루팅자(아이디)</label>
            <input
              className="w-full border rounded-lg px-3 py-2"
              placeholder="예: expoool"
              value={looterLoginId}
              onChange={(e) => setLooterLoginId(e.target.value)}
            />
            <p className="text-xs text-gray-500 mt-1">루팅 아이템이 있는 경우 필수</p>
          </div>
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
        </div>

        {/* 참여자 */}
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

        {/* 이미지 */}
        <div>
          <label className="block text-sm font-medium mb-1">캡쳐 이미지 (선택)</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setImage(e.target.files?.[0] ?? null)}
          />
        </div>

        {/* 액션 */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border bg-white hover:bg-slate-50">
            취소
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-xl bg-slate-900 text-white disabled:opacity-50"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </form>
    </div>
  );
}