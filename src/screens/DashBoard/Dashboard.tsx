import React from "react";
import { useAuth } from "../../contexts/AuthContext";
import IntroGuest from "../IntroGuest";
import LoggedInDashboard from "./LoggedInDashboard";

export default function Dashboard() {
  const { user } = useAuth();
  return user ? <LoggedInDashboard /> : <IntroGuest />;
}