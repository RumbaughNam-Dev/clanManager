import { useAuth } from "../../contexts/AuthContext";
import DashboardCombined from "../DashboardCombined";
import IntroGuest from "../IntroGuest";

export default function Dashboard() {
  const { user } = useAuth();
  return user ? <DashboardCombined /> : <IntroGuest />;
}