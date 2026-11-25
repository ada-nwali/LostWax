"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { explorerTx } from "@/lib/wagmi";

type Toast = { text: string; hash?: string; error?: boolean };
const Ctx = createContext<{ show: (t: Toast) => void }>({ show: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const show = useCallback((t: Toast) => {
    setToast(t);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 6000);
  }, []);

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      {toast && (
        <div className={`toast${toast.error ? " err" : ""}`} role="status">
          <div>{toast.text}</div>
          {toast.hash && (
            <a href={explorerTx(toast.hash)} target="_blank" rel="noreferrer">
              View on Uniscan →
            </a>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
