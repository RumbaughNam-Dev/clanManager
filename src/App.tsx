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
import Modal from "./components/common/Modal";
import { putJSON } from "./lib/http";

export default function App() {
  const [page, setPage] = useState<PageKey>("dashboard");
  const { role, user, logout, setUser } = useAuth();
  const [discordModalOpen, setDiscordModalOpen] = useState(false);
  const [discordLinkInput, setDiscordLinkInput] = useState("");
  const [discordSaving, setDiscordSaving] = useState(false);
  const apkUrl = `${import.meta.env.BASE_URL}clan-manager.apk`;
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
  const canEditDiscordLink = role === "LEADER" || role === "ADMIN" || role === "SUPERADMIN";
  const clanDiscordLink = user?.clanDiscordLink?.trim() || "";

  const guardAndNav = (next: PageKey) => {
    const publicPages: PageKey[] = ["dashboard", "login", "signup"];
    if (!user && !publicPages.includes(next)) {
      alert("로그인 페이지로 이동합니다.");
      setPage("login");
      return;
    }
    setPage(next);
  };

  const openDiscordModal = () => {
    setDiscordLinkInput(clanDiscordLink);
    setDiscordModalOpen(true);
  };

  const saveDiscordLink = async () => {
    if (!user?.clanId) {
      alert("혈맹 정보가 없어 저장할 수 없습니다.");
      return;
    }
    if (!canEditDiscordLink) {
      alert("디코 링크 수정 권한이 없습니다.");
      return;
    }
    setDiscordSaving(true);
    try {
      const res = await putJSON<{ ok: boolean; clanId: string; discordLink: string | null }>(
        `/v1/clans/${user.clanId}/discord-link`,
        { discordLink: discordLinkInput }
      );
      setUser((prev) => (prev ? { ...prev, clanDiscordLink: res.discordLink ?? null } : prev));
      setDiscordModalOpen(false);
      alert("디코 링크를 저장했습니다.");
    } catch (e: any) {
      alert(e?.body?.message ?? e?.message ?? "디코 링크 저장 실패");
    } finally {
      setDiscordSaving(false);
    }
  };

  return (
    <div className="min-h-screen min-w-[1440px] bg-slate-950 text-white relative overflow-x-auto overflow-y-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 -right-20 h-56 w-56 rounded-full bg-emerald-400/25 blur-3xl" />
        <div className="absolute bottom-[-120px] left-[-60px] h-72 w-72 rounded-full bg-sky-400/20 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_55%)]" />
      </div>
      {!isMobile && (
        <header className="sticky top-0 z-40 bg-slate-950/85 text-white backdrop-blur border-b border-white/10">
          <div className="mx-auto w-full min-w-[1440px] max-w-[1920px] px-6 h-16 flex items-center justify-between gap-4">
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
                  {clanDiscordLink ? (
                    <div className="flex items-center rounded-xl border border-white/20 overflow-hidden">
                      <a
                        href={clanDiscordLink}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 hover:bg-white/10"
                      >
                        디코 링크
                      </a>
                      {canEditDiscordLink && (
                        <>
                          <span className="text-white/30">|</span>
                          <button
                            type="button"
                            onClick={openDiscordModal}
                            className="px-3 py-1.5 text-white/70 hover:bg-white/10 hover:text-white"
                            aria-label="디코 링크 수정"
                            title="디코 링크 수정"
                          >
                            수정
                          </button>
                        </>
                      )}
                    </div>
                  ) : canEditDiscordLink ? (
                    <button
                      type="button"
                      onClick={openDiscordModal}
                      className="px-3 py-1.5 rounded-xl border border-white/20 hover:bg-white/10"
                    >
                      디코 링크 입력
                    </button>
                  ) : null}
                  <a
                    href={apkUrl}
                    download
                    className="px-3 py-1.5 rounded-xl border border-white/20 hover:bg-white/10"
                  >
                    모바일 APK 다운로드
                  </a>
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
        className={`mx-auto w-full min-w-[1440px] max-w-[1920px] px-6 ${
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

      {!isMobile && user && canEditDiscordLink && (
        <Modal
          open={discordModalOpen}
          onClose={() => setDiscordModalOpen(false)}
          title="디코 링크 입력"
          maxWidth="max-w-[520px]"
        >
          <div className="space-y-3">
            <input
              type="url"
              value={discordLinkInput}
              onChange={(e) => setDiscordLinkInput(e.currentTarget.value)}
              placeholder="https://discord.gg/..."
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/40"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDiscordModalOpen(false)}
                className="px-3 py-2 rounded-xl border border-white/10 hover:bg-white/10"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void saveDiscordLink()}
                disabled={discordSaving}
                className="px-3 py-2 rounded-xl bg-white/15 text-white hover:bg-white/20 disabled:opacity-60"
              >
                {discordSaving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
