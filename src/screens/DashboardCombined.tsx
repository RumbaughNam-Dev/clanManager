import { useState } from "react";
import LoggedInDashboard from "./DashBoard/LoggedInDashboard";
import TimelineList from "./TimelineList";

export default function DashboardCombined() {
  const [refreshTick, setRefreshTick] = useState(0);

  // 상단/하단 동기화용 리프레시 함수
  function forceRefresh() {
    setRefreshTick((k) => k + 1);
  }

  return (
    <div className="h-full min-h-0 overflow-hidden flex flex-col p-3 gap-3 bg-slate-100">
      {/* 상단: 대시보드 (70%) */}
      <div className="flex-[7] min-h-0 overflow-hidden border rounded-xl bg-white shadow-sm p-3">
        <LoggedInDashboard refreshTick={refreshTick} onForceRefresh={forceRefresh} />
      </div>

      {/* 하단: 잡은 보스 관리 (30%) */}
      <div className="flex-[3] min-h-0 overflow-hidden border rounded-xl bg-white shadow-sm p-3">
        <TimelineList refreshTick={refreshTick} />
      </div>
    </div>
  );
}