import { useEffect, useState } from "react";

export function usePersistedState<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => { try { const s = sessionStorage.getItem(key); return s ? (JSON.parse(s) as T) : initial; } catch { return initial; } });
  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify(v)); } catch {} }, [key, v]);
  return [v, setV] as const;
}

export async function copyText(text: string) { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } }

export const scoreTone = (s: number): "success" | "warn" | "danger" => (s >= 70 ? "success" : s >= 45 ? "warn" : "danger");

export function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

export const timeAgo = (iso: string) => {
  const d = (Date.now() - new Date(iso.replace(" ", "T")).getTime()) / 1000;
  if (d < 60) return "just now"; if (d < 3600) return `${Math.floor(d / 60)}m ago`; if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
};
