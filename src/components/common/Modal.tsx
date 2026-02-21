// src/components/common/Modal.tsx
import React, { useEffect } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  maxWidth?: string;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  /** 오버레이 클릭 시 닫힘 허용 여부 (기본값: true) */
  closeOnOverlay?: boolean;
  /** ESC 키로 닫힘 허용 여부 (기본값: true) */
  closeOnEsc?: boolean;
};

export default function Modal({
  open,
  onClose,
  title,
  maxWidth,
  footer,
  children,
  closeOnOverlay = true,
  closeOnEsc = true,
}: Props) {
  // ESC 키로 닫힘 제어
  useEffect(() => {
    if (!open || !closeOnEsc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeOnEsc, onClose]);

  if (!open) return null;

  const stop = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="fixed inset-0 z-[1000] text-white">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        // 오버레이로 닫히지 않도록 옵션 제공
        onMouseDown={closeOnOverlay ? onClose : stop}
        onClick={closeOnOverlay ? onClose : stop}
      />

      {/* Content 래퍼 */}
      <div
        className={`relative w-[92%] max-w-5xl mx-auto my-10 rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/90 to-slate-950/90 shadow-[0_20px_60px_rgba(0,0,0,0.45)] ${maxWidth ?? ""}`}
      >
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <h2 className="font-semibold text-white">{title}</h2>
          <button
            type="button"
            className="text-white/60 hover:text-white"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="p-4">{children}</div>

        {footer != null && (
          <div className="px-4 py-3 border-t border-white/10 flex justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
