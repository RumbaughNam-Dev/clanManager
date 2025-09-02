import { useState } from "react";
import PageHeader from "../components/common/PageHeader";
import Card from "../components/common/Card";
import Modal from "../components/common/Modal";
import type { Role } from "../contexts/AuthContext";

export default function BossMeta({ role }: { role: Role }) {
  const canEdit = role === "ADMIN" || role === "SUPERADMIN";
  const [openEdit, setOpenEdit] = useState(false);
  return (
    <div className="space-y-4">
      <PageHeader title="보스 메타 관리" right={canEdit && <button onClick={() => setOpenEdit(true)} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white">보스 메타 수정</button>} />
      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th className="py-2">보스</th>
              <th>주기</th>
              <th>윈도우</th>
              <th>채널</th>
            </tr>
          </thead>
          <tbody>
            {[
              { name: "데스나이트", cycle: "8h", window: "±10m", ch: "1-4" },
              { name: "리치", cycle: "12h", window: "±15m", ch: "All" },
            ].map((b, i) => (
              <tr key={i} className="border-t">
                <td className="py-2">{b.name}</td>
                <td>{b.cycle}</td>
                <td>{b.window}</td>
                <td>{b.ch}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal
        open={openEdit}
        title="보스 메타 수정"
        onClose={() => setOpenEdit(false)}
        footer={
          <>
            <button className="px-3 py-1.5 rounded-lg hover:bg-gray-100" onClick={() => setOpenEdit(false)}>
              취소
            </button>
            <button className="px-3 py-1.5 rounded-lg bg-slate-900 text-white" onClick={() => setOpenEdit(false)}>
              저장
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">보스명</label>
              <input className="w-full border rounded-lg px-2 py-2" placeholder="데스나이트" />
            </div>
            <div>
              <label className="block text-sm mb-1">주기(시간)</label>
              <input type="number" className="w-full border rounded-lg px-2 py-2" placeholder="8" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">윈도우(±분)</label>
              <input type="number" className="w-full border rounded-lg px-2 py-2" placeholder="10" />
            </div>
            <div>
              <label className="block text-sm mb-1">채널</label>
              <input className="w-full border rounded-lg px-2 py-2" placeholder="1-4" />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
