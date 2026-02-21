// screens/Dashboard.tsx
import { useAuth } from "../../contexts/AuthContext";
import IntroGuest from "../IntroGuest";
import LoggedInDashboard from "./LoggedInDashboard";

export default function Dashboard() {
  const { user } = useAuth();

  return user ? (
    <div className="relative w-full min-h-0 h-full flex justify-center bg-transparent overflow-hidden text-white">
      {/* 실제 콘텐츠 컨테이너: 1920px 기준 고정 폭 */}
      <div className="relative w-full min-h-0 h-full bg-transparent shadow-none overflow-hidden">
        <LoggedInDashboard />
      </div>
    </div>
  ) : (
    <IntroGuest />
  );
}
