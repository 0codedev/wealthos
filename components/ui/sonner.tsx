import * as React from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  type?: "success" | "error" | "info" | "default";
}

interface ToastContextType {
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastItem, "id">) => void;
  removeToast: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  const addToast = React.useCallback((toast: Omit<ToastItem, "id">) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      {/* Toast Render Viewport */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-start gap-3 p-3.5 rounded-[10px] border border-white/10 bg-[#0E101A] text-slate-200 shadow-2xl transition-all animate-in slide-in-from-bottom-2",
              t.type === "success" && "border-emerald-500/30",
              t.type === "error" && "border-rose-500/30",
              t.type === "info" && "border-indigo-500/30"
            )}
          >
            {t.type === "success" && <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />}
            {t.type === "error" && <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />}
            {t.type === "info" && <Info className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />}
            <div className="flex-1 text-xs">
              <div className="font-bold text-white">{t.title}</div>
              {t.description && <div className="text-slate-400 mt-0.5">{t.description}</div>}
            </div>
            <button
              onClick={() => removeToast(t.id)}
              className="text-slate-500 hover:text-white p-0.5"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useSonnerToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    return {
      success: (title: string, description?: string) => console.log(title, description),
      error: (title: string, description?: string) => console.error(title, description),
      info: (title: string, description?: string) => console.info(title, description),
    };
  }
  return {
    success: (title: string, description?: string) =>
      context.addToast({ title, description, type: "success" }),
    error: (title: string, description?: string) =>
      context.addToast({ title, description, type: "error" }),
    info: (title: string, description?: string) =>
      context.addToast({ title, description, type: "info" }),
  };
}
