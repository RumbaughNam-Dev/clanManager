// src/screens/Auth/Login.tsx
import React, { useEffect, useRef, useState } from "react";
import Card from "../../components/common/Card";
import PageHeader from "../../components/common/PageHeader";
import { useAuth } from "../../contexts/AuthContext";

type Props = {
  onGoSignup?: () => void; // ← 가입 페이지로 이동 콜백
};

export default function Login({ onGoSignup }: Props) {
  const { login } = useAuth();

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const idRef = useRef<HTMLInputElement>(null);
  useEffect(() => { idRef.current?.focus(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginId || !password || submitting) return;
    setSubmitting(true);
    try {
      await login(loginId, password); // 토큰 & 유저 상태 자동 처리
      // App.tsx에서 로그인 성공 후 라우팅
    } catch (e: any) {
      const msg = e?.body?.message || "로그인 정보가 존재하지 않습니다.";
      alert(msg);
    } finally {
      setSubmitting(false);
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

            {/* 가입 페이지 이동 버튼 */}
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
    </div>
  );
}