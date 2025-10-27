// src/screens/mobile/MobileLogin.tsx
import React from "react";
import Login from "../Auth/Login";

type Props = {
  onGoSignup: () => void;
};

export default function MobileLogin({ onGoSignup }: Props) {
  return (
    <div className="fixed inset-0 bg-black text-white flex flex-col justify-center items-center">
      <div className="w-full px-5 max-w-[400px]">
        <Login onGoSignup={onGoSignup} />
      </div>
    </div>
  );
}