// src/screens/Auth/Login.tsx
import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { postJSON } from "@/lib/http";
import Modal from "@/components/common/Modal";

type Props = {
  onGoSignup?: () => void;
};

export default function Login({ onGoSignup }: Props) {
  const { login } = useAuth();

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // ✅ 비밀번호 변경 팝업 상태
  const [mustChange, setMustChange] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [newPwConfirm, setNewPwConfirm] = useState("");

  const idRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    idRef.current?.focus();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginId || !password || submitting) return;
    setSubmitting(true);
    try {
      const res: any = await login(loginId, password);

      if (res?.mustChangePassword) {
        // ✅ 기본 비밀번호라면 팝업 띄우기
        setMustChange(true);
      } else {
        // App.tsx에서 라우팅
      }
    } catch (e: any) {
      const msg = e?.body?.message || "로그인 정보가 존재하지 않습니다.";
      alert(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ✅ 비밀번호 변경 처리
  const changePassword = async () => {
    if (!newPw || !newPwConfirm) {
      alert("비밀번호를 입력하세요.");
      return;
    }
    if (newPw !== newPwConfirm) {
      alert("비밀번호가 일치하지 않습니다.");
      return;
    }
    try {
      await postJSON("/v1/auth/change-password", {
        loginId,
        oldPassword: "1234", // 기본 비밀번호
        newPassword: newPw,
      });
      alert("비밀번호가 변경되었습니다. 다시 로그인하세요.");
      setMustChange(false);
      setPassword(""); // 비번 초기화
      setNewPw("");
      setNewPwConfirm("");
    } catch (e: any) {
      alert(e?.message ?? "비밀번호 변경 실패");
    }
  };

  return (
    <div
      className="fixed inset-0 overflow-hidden bg-slate-950 text-white"
      style={{ fontFamily: '"Space Grotesk", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif' }}
    >
      <div className="absolute inset-0">
        <div className="absolute -top-24 -right-20 h-56 w-56 rounded-full bg-emerald-400/30 blur-3xl" />
        <div className="absolute bottom-[-120px] left-[-60px] h-72 w-72 rounded-full bg-sky-400/25 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_55%)]" />
      </div>

      <div className="relative min-h-screen w-full grid items-center gap-8 px-8 py-16 md:grid-cols-[1.1fr,0.9fr] md:gap-10">
        <div className="space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/70">
            Clan Manager
          </div>
          <h1 className="text-3xl md:text-4xl font-black leading-tight">
            전쟁 준비는<br />정산부터.
          </h1>
          <p className="text-sm md:text-base text-white/70">
            컷 기록, 루팅, 분배까지 한 화면에서. 혈맹 운영이 가장 빠르게 정돈되는 곳.
          </p>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-white/70">
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">컷 타임 자동 계산</div>
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">드랍템 분배 기록</div>
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">혈비 귀속 처리</div>
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">참여자 관리</div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-6 text-white shadow-lg">
          <div className="mb-4">
            <h2 className="text-xl font-bold">로그인</h2>
            <p className="text-xs text-white/70">아이디와 비밀번호를 입력하세요.</p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-white/70 mb-1">아이디</label>
              <input
                ref={idRef}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-300/20"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                placeholder="아이디 입력"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-white/70 mb-1">비밀번호</label>
              <input
                type="password"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/50 focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-300/20"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호 입력"
              />
            </div>
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <button
                type="submit"
                disabled={!loginId || !password || submitting}
                className={`w-full md:w-auto px-5 py-2 rounded-xl font-bold transition-colors duration-150
                  ${loginId && password && !submitting
                    ? "bg-white text-slate-900 hover:bg-emerald-100"
                    : "bg-white/30 text-white/70 cursor-not-allowed"}`}
              >
                {submitting ? "로그인 중..." : "로그인"}
              </button>
              <button
                type="button"
                onClick={() => onGoSignup?.()}
                className="w-full md:w-auto px-5 py-2 rounded-xl font-bold border border-white/20 text-white/80 hover:bg-white/10 transition-colors duration-150"
              >
                혈맹 등록요청
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* ✅ 비밀번호 변경 팝업 */}
      {mustChange && (
        <Modal
          open={mustChange}
          onClose={() => setMustChange(false)}
          title="비밀번호 변경"
          maxWidth="max-w-[420px]"
        >
          <p className="text-sm text-white/70 mb-3">
            기본 비밀번호(1234)로 로그인했습니다. 반드시 새 비밀번호로 변경하세요.
          </p>
          <div className="space-y-3">
            <div>
              <label className="block text-sm mb-1 text-white/70">새 비밀번호</label>
              <input
                type="password"
                className="w-full ui-input"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="새 비밀번호"
              />
            </div>
            <div>
              <label className="block text-sm mb-1 text-white/70">비밀번호 확인</label>
              <input
                type="password"
                className="w-full ui-input"
                value={newPwConfirm}
                onChange={(e) => setNewPwConfirm(e.target.value)}
                placeholder="비밀번호 확인"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setMustChange(false)}
              className="px-3 py-1.5 rounded-lg border border-white/10 text-white/80 hover:bg-white/10 text-sm"
            >
              취소
            </button>
            <button
              onClick={changePassword}
              className="px-3 py-1.5 rounded-lg bg-white/15 text-white text-sm hover:bg-white/20"
            >
              변경
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
