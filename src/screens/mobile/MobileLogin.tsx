// src/screens/mobile/MobileLogin.tsx
import React from "react";
import Login from "../Auth/Login";

type Props = {
  onGoSignup: () => void;
};

export default function MobileLogin({ onGoSignup }: Props) {
  return (
    <div className="min-h-[calc(100vh-56px)] bg-[#0b0b0b] text-white flex items-center justify-center p-4">
      <div className="w-full max-w-[420px]">
        <h1 className="text-2xl font-extrabold mb-4">클랜 매니저</h1>

        {/* 모바일에서 기본 폰트/터치 타깃을 키우기 위해 컨테이너로 감쌈 */}
        <div className="bg-[#161616] rounded-2xl p-4 shadow-lg">
          {/* 기존 Login 폼 재사용 (API/토큰/컨텍스트 그대로) */}
          <Login onGoSignup={onGoSignup} />
        </div>

        <div className="mt-4 text-sm text-gray-400">
          모바일 전용 화면입니다. PC에서는 상단 네비게이션을 이용해 주세요.
        </div>
      </div>
    </div>
  );
}