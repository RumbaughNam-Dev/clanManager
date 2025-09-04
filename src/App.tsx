// src/App.tsx
import { useEffect, useMemo, useState } from "react";
import type { PageKey, Role } from "./types";
import { useAuth } from "./contexts/AuthContext";
import Dashboard from "./screens/DashBoard/Dashboard";
import Members from "./screens/Members";
import TimelineList from "./screens/TimelineList";
import TimelineDetail from "./screens/TimelineDetail";
import Treasury from "./screens/Treasury";
import Login from "./screens/Auth/Login";
import Signup from "./screens/Auth/Signup";
import AdminClanRequests from "./screens/SuperAdmin/AdminClanRequests";
import AdminBossCycle from "./screens/SuperAdmin/AdminBossCycle";

export default function App() {
  const [page, setPage] = useState<PageKey>("dashboard");
  const { role, user, logout } = useAuth();

  const serverDisplay =
    (user as any)?.serverDisplay ??
    (typeof localStorage !== "undefined" ? localStorage.getItem("serverDisplay") : "") ??
    "";

  useEffect(() => {
    if (user && (page === "login" || page === "signup")) {
      setPage("dashboard");
    }
  }, [user, page]);

  const roleLabel = (r?: string | null) => {
    switch (r) {
      case "SUPERADMIN":
        return "운영자";
      case "ADMIN":
        return "관리자";
      case "LEADER":
        return "간부";
      case "USER":
        return "혈맹원";
      default:
        return r ?? "";
    }
  };

  const navItems = useMemo(() => {
    if (role === "SUPERADMIN") {
      return [
        { key: "dashboard" as PageKey, label: "대시보드" },
        { key: "adminClanRequests" as PageKey, label: "혈맹 등록요청 처리" },
        { key: "adminBossCycle" as PageKey, label: "보스 젠 주기 관리" },
      ];
    }
    const base = [
      { key: "dashboard" as PageKey, label: "대시보드" },
      { key: "timelineList" as PageKey, label: "잡은보스 관리" },
      { key: "treasury" as PageKey, label: "혈비 관리" }, // ← 라벨 정정
    ];
    if (role === "ADMIN" || role === "LEADER") {
      base.splice(1, 0, { key: "members" as PageKey, label: "혈맹원 관리" });
    }
    return base;
  }, [role]);

  const effectiveRole = (role ?? "USER") as Role;

  const guardAndNav = (next: PageKey) => {
    const publicPages: PageKey[] = ["dashboard", "login", "signup"];
    if (!user && !publicPages.includes(next)) {
      alert("로그인 해 주세요.");
      setPage("login");
      return;
    }
    setPage(next);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-xl font-extrabold">Clan Manager</span>
            <nav className="hidden md:flex gap-1">
              {navItems.map((p) => (
                <button
                  key={p.key}
                  onClick={() => guardAndNav(p.key)}
                  className={`px-3 py-1.5 rounded-xl text-sm ${
                    page === p.key ? "bg-slate-900 text-white" : "hover:bg-slate-100"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {user ? (
              <>
                <span className="px-2 py-1 rounded bg-slate-100">
                  {user.loginId}
                  {serverDisplay ? ` - ${serverDisplay}` : ""}
                  {user.clanName ? ` · ${user.clanName}` : ""}
                  {` (${roleLabel(role)})`}
                </span>
                <button
                  onClick={() => {
                    logout();
                    // 필요 시 전체 새로고침:
                    // window.location.reload();
                  }}
                  className="px-3 py-1.5 rounded-xl hover:bg-slate-100"
                >
                  로그아웃
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setPage("login")}
                  className="px-3 py-1.5 rounded-xl hover:bg-slate-100"
                >
                  로그인
                </button>
                <button
                  onClick={() => setPage("signup")}
                  className="px-3 py-1.5 rounded-xl hover:bg-slate-100"
                >
                  가입
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 py-6 space-y-6">
        {page === "dashboard" && <Dashboard />}
        {page === "members" && <Members />}
        {page === "timelineList" && <TimelineList />}
        {page === "timelineDetail" && <TimelineDetail role={effectiveRole} />}
        {page === "treasury" && <Treasury role={effectiveRole} />}
        {page === "login" && (
          <Login onGoSignup={() => setPage("signup")} />
        )}
        {page === "signup" && <Signup />}
        {page === "adminClanRequests" && <AdminClanRequests />}
        {page === "adminBossCycle" && <AdminBossCycle />}
      </main>
    </div>
  );
}