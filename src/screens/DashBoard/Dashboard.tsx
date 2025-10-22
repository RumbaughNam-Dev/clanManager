// screens/Dashboard.tsx
import { useAuth } from "../../contexts/AuthContext";
import IntroGuest from "../IntroGuest";
import LoggedInDashboard from "./LoggedInDashboard";

export default function Dashboard() {
  const { user } = useAuth();

  return user ? (
    <div className="w-full min-h-0 h-full flex justify-center bg-slate-100 overflow-hidden py-4">
      {/* 실제 콘텐츠 컨테이너: 1920px 기준 고정 폭 */}
      <div className="w-[1920px] max-w-[1920px] min-h-0 h-full border rounded-xl bg-white shadow-sm p-4 overflow-hidden">
        <LoggedInDashboard />
      </div>
    </div>
  ) : (
    <IntroGuest />
  );
}