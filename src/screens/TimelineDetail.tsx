import React, { useState } from "react";
import PageHeader from "../components/common/PageHeader";
import Card from "../components/common/Card";
import Pill from "../components/common/Pill";
import Modal from "../components/common/Modal";
import type { Role } from "../contexts/AuthContext";

export default function TimelineDetail({ role }: { role: Role }) {
  const [openSale, setOpenSale] = useState(false);
  const participants = ["Mukbo", "DiverKim", "Alice", "Bob"];
  const perHead = 120000 / participants.length;

  return (
    <div className="space-y-4">
      <PageHeader title="타임라인 상세" subtitle="데스나이트 · 2025-08-12 17:10" right={<Pill tone="warning">판매전</Pill>} />

      <div className="grid md:grid-cols-3 gap-4">
        <Card className="md:col-span-2">
          <div className="font-semibold mb-2">참여자</div>
          <ul className="space-y-2">
            {participants.map((n) => (
              <li key={n} className="flex items-center justify-between border rounded-xl p-2">
                <span>{n}</span>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" /> 분배 완료
                </label>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <div className="font-semibold mb-2">드랍/판매</div>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span>축복의 반지 · 루팅자: Mukbo</span>
              <Pill>판매전</Pill>
            </div>
            <div className="flex items-center justify-between">
              <span>고대 파편 · 혈비 귀속</span>
              <Pill>귀속 예정</Pill>
            </div>
          </div>
          <button onClick={() => setOpenSale(true)} className="mt-3 w-full px-3 py-2 rounded-lg bg-slate-900 text-white">판매 완료 처리</button>
        </Card>
      </div>

      <Card>
        <div className="font-semibold mb-2">자동 분배 미리보기</div>
        <div className="text-sm">총 판매액(순액) 120,000 → 인당 {perHead.toLocaleString()}원</div>
      </Card>

      <Modal
        open={openSale}
        title="판매 완료 처리"
        onClose={() => setOpenSale(false)}
        footer={
          <>
            <button className="px-3 py-1.5 rounded-lg hover:bg-gray-100" onClick={() => setOpenSale(false)}>
              취소
            </button>
            <button className="px-3 py-1.5 rounded-lg bg-slate-900 text-white" onClick={() => setOpenSale(false)}>
              저장
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="block text-sm mb-1">순수령 금액</label>
            <input type="number" className="w-full border rounded-lg px-2 py-2" placeholder="수수료 제외 금액" />
          </div>
          <div>
            <label className="block text-sm mb-1">증빙 스크린샷</label>
            <input type="file" className="w-full border rounded-lg px-2 py-2" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
