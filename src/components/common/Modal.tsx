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
    <div className="fixed inset-0 z-[1000]">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/30"
        // 오버레이로 닫히지 않도록 옵션 제공
        onMouseDown={closeOnOverlay ? onClose : stop}
        onClick={closeOnOverlay ? onClose : stop}
      />

      {/* Content 래퍼 */}
      <div className={`relative bg-white rounded-2xl shadow-xl w-[92%] max-w-5xl mx-auto my-10 ${maxWidth ?? ""}`}>
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="font-semibold">{title}</h2>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="p-4">{children}</div>

        {footer != null && (
          <div className="px-4 py-3 border-t flex justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}