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
import { useIsMobile } from "./hooks/useIsMobile";
import MobileLogin from "./screens/mobile/MobileLogin";
import Signup from "./screens/Auth/Signup";
import AdminClanRequests from "./screens/SuperAdmin/AdminClanRequests";
import AdminBossCycle from "./screens/SuperAdmin/AdminBossCycle";
import MobileDashboard from "./screens/mobile/MobileDashboard";
import FeedbackBoard from "./screens/Feedback/FeedbackBoard";
import RaidManage from "./screens/RaidManage/RaidManage";

export default function App() {
  const [page, setPage] = useState<PageKey>("dashboard");
  const { role, user, logout } = useAuth();
  const isMobile = (() => {
    const qsMobile =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("mobile") === "1";
    return qsMobile || useIsMobile();
  })();

  // ✅ 모바일에서는 인트로(대시보드 초기화면) 대신 로그인 페이지로 이동
  useEffect(() => {
    if (isMobile && !user) {
      setPage("login");
    }
  }, [isMobile, user]);

  const serverDisplay =
    (user as any)?.serverDisplay ??
    (typeof localStorage !== "undefined"
      ? localStorage.getItem("serverDisplay")
      : "") ??
    "";

  useEffect(() => {
    if (user && (page === "login" || page === "signup")) {
      setPage("dashboard");
    }
  }, [user, page]);

  // 🔒 대시보드에서만 body 스크롤 잠그고, 다른 페이지에선 자동 해제
  useEffect(() => {
    const cls = "body-lock";
    if (page === "dashboard") {
      document.body.classList.add(cls);
    } else {
      document.body.classList.remove(cls);
    }
    return () => {
      document.body.classList.remove(cls);
    };
  }, [page]);

  useEffect(() => {
    const publicPages: PageKey[] = ["dashboard", "login", "signup", "feedback"];
    if (!user && !publicPages.includes(page)) {
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
        { key: "feedback" as PageKey, label: "불편사항 건의하기" },
      ];
    }
    const base = [
      { key: "dashboard" as PageKey, label: "대시보드" },
      { key: "timelineList" as PageKey, label: "잡은보스 관리" },
      { key: "raidManage" as PageKey, label: "혈레이드 관리" },
      { key: "treasury" as PageKey, label: "혈비 관리" },
      { key: "feedback" as PageKey, label: "불편사항 건의하기" },
    ];
    if (role === "ADMIN" || role === "LEADER") {
      base.splice(4, 0, { key: "members" as PageKey, label: "혈맹원 관리" });
    }
    return base;
  }, [role]);

  const effectiveRole = (role ?? "USER") as Role;

  const guardAndNav = (next: PageKey) => {
    const publicPages: PageKey[] = ["dashboard", "login", "signup", "feedback"];
    if (!user && !publicPages.includes(next)) {
      setPage("dashboard"); // ← 로그인 페이지 말고 대시보드로
      return;
    }
    setPage(next);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {!isMobile && (
        <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b">
          <div className="mx-auto w-full max-w-[1920px] px-6 h-14 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {/* 🔗 로고 클릭 시 대시보드로 이동 */}
              <button
                onClick={() => guardAndNav("dashboard")}
                className="text-xl font-extrabold focus:outline-none"
              >
                린엠 매니저
              </button>
              <nav className="hidden md:flex gap-1">
                {navItems.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => guardAndNav(p.key)}
                    className={`px-3 py-1.5 rounded-xl text-sm ${
                      page === p.key
                        ? "bg-slate-900 text-white"
                        : "hover:bg-slate-100"
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
                      setPage("dashboard");
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
      )}

      <main
        className={`mx-auto w-full max-w-[1920px] px-6 ${
          page === "dashboard"
            ? "h-[calc(100vh-56px)] flex flex-col"
            : "py-6 space-y-6"
        }`}
      >
        {page === "dashboard" && (isMobile ? <MobileDashboard /> : <Dashboard />)}
        {page === "members" && <Members />}
        {page === "timelineList" && <TimelineList />}
        {page === "timelineDetail" && <TimelineDetail role={effectiveRole} />}
        {page === "raidManage" && <RaidManage />}
        {page === "treasury" && <Treasury role={effectiveRole} />}
        {page === "feedback" && <FeedbackBoard />}
        {page === "login" &&
        (isMobile ? (
          <MobileLogin onGoSignup={() => setPage("signup")} />
        ) : (
          <Login onGoSignup={() => setPage("signup")} />
        ))}
        {page === "signup" && <Signup />}
        {page === "adminClanRequests" && <AdminClanRequests />}
        {page === "adminBossCycle" && <AdminBossCycle />}
      </main>
    </div>
  );
}