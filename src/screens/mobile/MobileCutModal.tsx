import React, { useEffect, useMemo, useState } from "react";
import { postJSON } from "@/lib/http";
import type { BossDto } from "@/types";

type Props = {
  open: boolean;
  boss: BossDto | null;
  onClose: () => void;
  onSaved: () => void;
};

/**
 * 모바일 전용 풀스크린 시트.
 * - 최소 필드만: 컷 시간(기본=지금), 메모(옵션)
 * - 저장 시: items/participants 없이 컷만 기록 (mode='TREASURY'로 백엔드 호환)
 */
export default function MobileCutModal({ open, boss, onClose, onSaved }: Props) {
  const [saving, setSaving] = useState(false);

  // 기본값: 현재 시각을 'YYYY-MM-DDTHH:MM' 형태로
  const defaultLocal = useMemo(() => {
    const d = new Date();
    d.setSeconds(0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, []);

  const [cutLocal, setCutLocal] = useState(defaultLocal);
  const [note, setNote] = useState("");

  // 보스 변경/열림 시마다 리셋
  useEffect(() => {
    if (!open) return;
    const d = new Date();
    d.setSeconds(0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    const next = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setCutLocal(next);
    setNote("");
  }, [open, boss?.id]);

  if (!open || !boss) return null;

  // 로컬 datetime-local → ISO
  function toIso(localStr: string) {
    // localStr 예: "2025-09-05T14:20"
    const d = new Date(localStr);
    if (isNaN(d.getTime())) return null;
    return d.toString();
    // 필요 시 타임존 보정 로직을 별도로 둘 수 있음
  }

  async function handleSave() {
    if (saving) return;
    const iso = toIso(cutLocal);
    if (!iso) {
      alert("시간 형식이 올바르지 않습니다.");
      return;
    }

    setSaving(true);
    try {
      await postJSON(`/v1/dashboard/bosses/${boss!.id}/cut`, {
        cutAtIso: iso,
        mode: "TREASURY",
        items: [],
        participants: [],
        // imageFileName, lootUsers 등은 사용하지 않음(모바일 간편 입력)
        // note는 백엔드 스키마에 따라 저장할 필드에 맞춰 붙이면 됨 (예: memo)
        // memo: note,  ← 백엔드에 해당 필드가 있을 때만 쓰세요
      });
      onSaved();
    } catch (e: any) {
      alert(e?.message ?? "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100]">
      {/* dim */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* sheet */}
      <div className="absolute inset-x-0 bottom-0 top-12 bg-white rounded-t-2xl shadow-xl flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="text-base font-semibold">{boss.name} 컷 기록</div>
          <button
            type="button"
            className="text-slate-500 text-sm"
            onClick={onClose}
          >
            닫기
          </button>
        </div>

        {/* 본문 */}
        <div className="p-4 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium mb-1">컷 시간</label>
            <input
              type="datetime-local"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={cutLocal}
              onChange={(e) => setCutLocal(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-500">
              기본값은 현재 시각입니다.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">메모(선택)</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="예: 컷 주체/상세 등"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="text-xs text-slate-500">
            ※ 모바일 간편 입력: 아이템/참여자 없이 시간을 기록합니다. 상세 기록은 PC 페이지에서 해주세요.
          </div>
        </div>

        {/* 푸터 */}
        <div className="p-4 border-t flex gap-2">
          <button
            type="button"
            className="flex-1 border rounded-lg py-2 text-sm"
            onClick={onClose}
          >
            취소
          </button>
          <button
            type="button"
            className={`flex-1 rounded-lg py-2 text-sm text-white ${saving ? "bg-gray-300" : "bg-slate-900"}`}
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}