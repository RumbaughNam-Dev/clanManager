// src/screens/mobile/MobileLogin.tsx
import Login from "../Auth/Login";
import "./mobile-login.css";

type Props = {
  onGoSignup: () => void;
};

export default function MobileLogin({ onGoSignup }: Props) {
  return (
    <div className="mobile-login fixed inset-0 bg-black text-white">
      <div className="absolute inset-[5%] flex items-center justify-center">
        <div className="w-full max-w-[520px]">
          <Login onGoSignup={onGoSignup} />
        </div>
      </div>
    </div>
  );
}