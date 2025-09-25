import { useState } from "react";
import LoggedInDashboard from "./DashBoard/LoggedInDashboard";
import TimelineList from "./TimelineList";

export default function DashboardCombined() {
  const [refreshTick, setRefreshTick] = useState(0);

  function forceRefresh() {
    setRefreshTick((k) => k + 1);
  }

  return (
    // ✅ padding은 내부에 주고, 바깥 래퍼는 h-screen + overflow-hidden
    <div className="h-screen flex flex-col min-h-0 bg-slate-100">
      <div className="flex-1 min-h-0 overflow-hidden p-3">
        <div className="h-full border rounded-xl bg-white shadow-sm p-3">
          <LoggedInDashboard refreshTick={refreshTick} onForceRefresh={forceRefresh} />
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col min-h-0 overflow-hidden p-3">
        <div className="h-full border rounded-xl bg-white shadow-sm p-3">
          <TimelineList refreshTick={refreshTick} />
        </div>
      </div>
    </div>
  );
}