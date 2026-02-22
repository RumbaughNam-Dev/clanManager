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
    const publicPages: PageKey[] = ["dashboard", "login", "signup"];
    if (!user && !publicPages.includes(page)) {
      alert("로그인 페이지로 이동합니다.");
      setPage("login");
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
    const publicPages: PageKey[] = ["dashboard", "login", "signup"];
    if (!user && !publicPages.includes(next)) {
      alert("로그인 페이지로 이동합니다.");
      setPage("login");
      return;
    }
    setPage(next);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 -right-20 h-56 w-56 rounded-full bg-emerald-400/25 blur-3xl" />
        <div className="absolute bottom-[-120px] left-[-60px] h-72 w-72 rounded-full bg-sky-400/20 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_55%)]" />
      </div>
      {!isMobile && (
        <header className="sticky top-0 z-40 bg-slate-950/85 text-white backdrop-blur border-b border-white/10">
          <div className="mx-auto w-full max-w-[1920px] px-6 h-16 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {/* 🔗 로고 클릭 시 대시보드로 이동 */}
              <button
                onClick={() => guardAndNav("dashboard")}
                className="text-lg font-extrabold tracking-wide focus:outline-none"
              >
                린엠 매니저
              </button>
              <nav className="hidden md:flex gap-1">
                {navItems.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => guardAndNav(p.key)}
                    className={`px-3 py-1.5 rounded-xl text-sm transition-colors ${
                      page === p.key
                        ? "bg-white/10 text-white"
                        : "text-white/70 hover:text-white hover:bg-white/5"
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
                  <span className="px-2 py-1 rounded bg-white/10 text-white/90">
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
                    className="px-3 py-1.5 rounded-xl hover:bg-white/10"
                  >
                    로그아웃
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setPage("login")}
                    className="px-3 py-1.5 rounded-xl hover:bg-white/10"
                  >
                    로그인
                  </button>
                  <button
                    onClick={() => setPage("signup")}
                    className="px-3 py-1.5 rounded-xl border border-white/20 hover:bg-white/10"
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
            ? (isMobile ? "h-[100dvh] overflow-y-auto" : "h-[calc(100vh-56px)] flex flex-col")
            : "h-[calc(100vh-56px)] overflow-y-auto py-6 space-y-6"
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
