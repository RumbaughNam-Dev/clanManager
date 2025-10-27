// src/screens/mobile/MobileLogin.tsx
import Login from "../Auth/Login";
import "./mobile-login.css";

type Props = {
  onGoSignup: () => void;
};

export default function MobileLogin({ onGoSignup }: Props) {
  return (
    <div className="mobile-login fixed inset-0 bg-black text-white">
    {/* 좌/우 여백 제거, 위/아래만 5% 유지 + 중앙 정렬 */}
    <div className="absolute left-0 right-0 top-[5%] bottom-[5%] flex items-center justify-center">
        {/* 가로 폭 1.5배 확대 (520 → 780), 너무 가장자리에 붙지 않도록 약간의 padding */}
        <div className="w-full max-w-[780px] px-4">
        <Login onGoSignup={onGoSignup} />
        </div>
    </div>
    </div>
  );
}