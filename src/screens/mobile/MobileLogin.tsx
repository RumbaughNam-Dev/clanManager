// src/screens/mobile/MobileLogin.tsx
import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { postJSON } from "@/lib/http";
import Modal from "@/components/common/Modal";
import "./mobile-login.css";

type Props = {
  onGoSignup: () => void;
};

export default function MobileLogin({ onGoSignup }: Props) {
  const { login } = useAuth();

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
        setMustChange(true);
      }
    } catch (e: any) {
      const msg = e?.body?.message || "로그인 정보가 존재하지 않습니다.";
      alert(msg);
    } finally {
      setSubmitting(false);
    }
  };

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
        oldPassword: "1234",
        newPassword: newPw,
      });
      alert("비밀번호가 변경되었습니다. 다시 로그인하세요.");
      setMustChange(false);
      setPassword("");
      setNewPw("");
      setNewPwConfirm("");
    } catch (e: any) {
      alert(e?.message ?? "비밀번호 변경 실패");
    }
  };

  return (
    <div
      className="mobile-login fixed inset-0 overflow-hidden bg-slate-950 text-white"
      style={{ fontFamily: '"Space Grotesk", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif' }}
    >
      <div className="absolute inset-0">
        <div className="absolute -top-20 -right-16 h-44 w-44 rounded-full bg-emerald-400/25 blur-3xl" />
        <div className="absolute bottom-[-100px] left-[-50px] h-56 w-56 rounded-full bg-sky-400/20 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.1),transparent_60%)]" />
      </div>

      <div className="relative min-h-screen w-full px-6 pt-24 pb-14 flex flex-col text-[1.3em] gap-10">
        <div className="flex flex-col items-center text-center gap-4">
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.55em] uppercase tracking-[0.25em] text-white/70">
            Clan Manager
          </div>
          <h1 className="mt-2 text-[1.7em] font-black leading-tight">
            리니지M
            <br />
            보스 · 혈맹 관리 시스템
          </h1>
        </div>

        <div className="mt-2 rounded-2xl border border-white/10 bg-slate-900/80 p-5 shadow-lg">
          <div className="mb-4 text-center">
            <h2 className="text-[1.25em] font-bold">로그인</h2>
            <p className="text-[0.8em] text-white/70">아이디와 비밀번호를 입력하세요.</p>
          </div>
          <form onSubmit={submit} className="space-y-5">
            <div>
              <label className="block text-[0.75em] font-semibold text-white/70 mb-1">아이디</label>
              <input
                ref={idRef}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-[1em] text-white placeholder:text-white/50 focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-300/20"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                placeholder="아이디 입력"
              />
            </div>
            <div>
              <label className="block text-[0.75em] font-semibold text-white/70 mb-1">비밀번호</label>
              <input
                type="password"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-[1em] text-white placeholder:text-white/50 focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-300/20"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호 입력"
              />
            </div>
            <div className="flex flex-col gap-4 pt-2">
              <button
                type="submit"
                disabled={!loginId || !password || submitting}
                className={`w-full px-5 py-3.5 rounded-2xl text-[1em] font-bold transition-colors duration-150
                  ${loginId && password && !submitting
                    ? "bg-white text-slate-900 hover:bg-emerald-100"
                    : "bg-white/30 text-white/70 cursor-not-allowed"}`}
              >
                {submitting ? "로그인 중..." : "로그인"}
              </button>
              <p className="text-center text-[0.8em] text-white/60">
                혈맹 등록요청은 PC 웹에서 요청해 주세요.
              </p>
            </div>
          </form>
        </div>

        <div className="grid grid-cols-2 gap-3 text-[0.8em] text-white/70">
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-center">컷 타임 자동 계산</div>
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-center">드랍템 분배 기록</div>
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-center">혈비 귀속 처리</div>
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-center">참여자 관리</div>
        </div>
      </div>

      {mustChange && (
        <Modal
          open={mustChange}
          onClose={() => setMustChange(false)}
          title="비밀번호 변경"
          maxWidth="max-w-[420px]"
        >
          <div className="text-[1em]">
          <p className="text-[0.9em] text-white/70 mb-4">
            기본 비밀번호(1234)로 로그인했습니다. 반드시 새 비밀번호로 변경하세요.
          </p>
          <div className="space-y-4">
            <div>
              <label className="block text-[0.85em] mb-1 text-white/70">새 비밀번호</label>
              <input
                type="password"
                className="w-full ui-input text-[1em]"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="새 비밀번호"
              />
            </div>
            <div>
              <label className="block text-[0.85em] mb-1 text-white/70">비밀번호 확인</label>
              <input
                type="password"
                className="w-full ui-input text-[1em]"
                value={newPwConfirm}
                onChange={(e) => setNewPwConfirm(e.target.value)}
                placeholder="비밀번호 확인"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setMustChange(false)}
              className="px-4 py-2 rounded-lg border border-white/10 text-white/80 hover:bg-white/10 text-[0.9em]"
            >
              취소
            </button>
            <button
              onClick={changePassword}
              className="px-4 py-2 rounded-lg bg-white/15 text-white text-[0.9em] hover:bg-white/20"
            >
              변경
            </button>
          </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
