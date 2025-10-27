// src/screens/mobile/MobileLogin.tsx
import React from "react";
import Login from "../Auth/Login";

type Props = {
  onGoSignup: () => void;
};

export default function MobileLogin({ onGoSignup }: Props) {
  return (
    <div className="fixed inset-[5%] bg-black text-white">
      <div className="w-full h-full">
        <Login onGoSignup={onGoSignup} />
      </div>
    </div>
  );
}