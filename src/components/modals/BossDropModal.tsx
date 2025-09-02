// props: { open: boolean; timelineId?: string | null; ... }
import React, { useEffect, useState } from "react";
import { getJSON } from "../../lib/http";

type LootItemDto = {
  id: string;
  itemName: string;
  isSold: boolean;
  isTreasury?: boolean;
  toTreasury?: boolean;
  soldPrice?: number | null;
  soldAt?: string | null;
};

type DistributionDto = {
  lootItemId: string | null;
  recipientLoginId: string;
  isPaid: boolean;
};

type DetailResp = {
  ok: true;
  item: {
    id: string;
    bossName: string;
    cutAt: string;
    createdBy: string;
    items: LootItemDto[];
    distributions: DistributionDto[];
  };
};

export default function BossDropModal({ open, timelineId, onClose }: {
  open: boolean;
  timelineId?: string | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [data, setData]     = useState<DetailResp["item"] | null>(null);

  useEffect(() => {
    if (!open || !timelineId) return;

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        setData(null);

        // ✅ 실제 데이터 요청 (GET /v1/boss-timelines/:id)
        const res = await getJSON<DetailResp>(`/v1/boss-timelines/${timelineId}`);

        if (!cancelled) {
          setData(res.item);
        }
      } catch (e: any) {
        if (!cancelled) {
          console.error("[BossDropModal] load failed:", e);
          setError(e?.message ?? "데이터를 불러오지 못했습니다.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, timelineId]);

  if (!open) return null;

  return (
    <div className="p-4">
      {loading && <div className="text-sm text-slate-500">불러오는 중…</div>}
      {!loading && error && (
        <div className="text-sm text-rose-600">
          {error}
          <button
            className="ml-2 underline"
            onClick={() => {
              // 간단 재시도
              if (timelineId) {
                // 의도적으로 deps를 바꾸기 어려우니 상태를 흔들어 재호출
                // 또는 로딩 함수를 분리해서 직접 호출해도 됨.
                // 여기선 onClose 후 다시 여는 식으로도 가능.
                // 필요하면 별도의 reload 상태를 만들어 set 해도 OK.
              }
            }}
          >
            재시도
          </button>
        </div>
      )}
      {!loading && !error && data && (
        <div>
          <div className="font-semibold mb-2">
            {data.bossName} · {new Date(data.cutAt).toLocaleString("ko-KR", { hour12: false })}
          </div>
          {/* …여기에 아이템/분배 표 렌더링 … */}
        </div>
      )}
    </div>
  );
}