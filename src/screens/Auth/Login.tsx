// src/screens/Auth/Login.tsx
import React, { useEffect, useRef, useState } from "react";
import Card from "../../components/common/Card";
import PageHeader from "../../components/common/PageHeader";
import { useAuth } from "../../contexts/AuthContext";
import { postJSON } from "@/lib/http";

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
    <div className="space-y-4">
      <PageHeader title="로그인" subtitle="아이디와 비밀번호를 입력하세요" />
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm mb-1">아이디</label>
            <input
              ref={idRef}
              className="w-full border rounded-lg px-3 py-2"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              placeholder="아이디"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">비밀번호</label>
            <input
              type="password"
              className="w-full border rounded-lg px-3 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호"
            />
          </div>
          <div className="flex items-center justify-between">
            <button
              type="submit"
              disabled={!loginId || !password || submitting}
              className={`px-4 py-2 rounded-xl ${
                loginId && password && !submitting
                  ? "bg-slate-900 text-white"
                  : "bg-gray-200 text-gray-500 cursor-not-allowed"
              }`}
            >
              {submitting ? "로그인 중..." : "로그인"}
            </button>
            <button
              type="button"
              onClick={() => onGoSignup?.()}
              className="text-sm text-blue-600 hover:underline"
            >
              아직 계정이 없으신가요? 가입하기
            </button>
          </div>
        </form>
      </Card>

      {/* ✅ 비밀번호 변경 팝업 */}
      {mustChange && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl w-80 space-y-4 shadow-lg">
            <h2 className="text-lg font-bold">비밀번호 변경</h2>
            <p className="text-sm text-gray-600">
              기본 비밀번호(1234)로 로그인했습니다. 반드시 새 비밀번호로 변경하세요.
            </p>
            <div>
              <label className="block text-sm mb-1">새 비밀번호</label>
              <input
                type="password"
                className="w-full border rounded-lg px-3 py-2"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="새 비밀번호"
              />
            </div>
            <div>
              <label className="block text-sm mb-1">비밀번호 확인</label>
              <input
                type="password"
                className="w-full border rounded-lg px-3 py-2"
                value={newPwConfirm}
                onChange={(e) => setNewPwConfirm(e.target.value)}
                placeholder="비밀번호 확인"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setMustChange(false)}
                className="px-3 py-1.5 rounded-lg bg-gray-200 text-gray-700 text-sm"
              >
                취소
              </button>
              <button
                onClick={changePassword}
                className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-sm"
              >
                변경
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}