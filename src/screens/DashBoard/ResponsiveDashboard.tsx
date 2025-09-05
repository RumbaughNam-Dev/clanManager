import MobileDashboard from "@/screens/mobile/MobileBossDashboard";
import LoggedInDashboard from "./LoggedInDashboard";
import { useIsMobile } from "@/hooks/useIsMobile";

export default function ResponsiveDashboard() {
  const isMobile = useIsMobile(768); // <768px 이면 모바일
  return isMobile ? <MobileDashboard /> : <LoggedInDashboard />;
}