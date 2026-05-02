"use client";

import { useEffect, useRef, useState } from "react";

import { isWatchdogPingAllowed } from "@/lib/mainThreadWatchdogBridge";

/**
 * トップページ用: Web Worker がメインスレッドへ ping。
 * 約 3 秒以上 pong が返らない場合に再読み込みを促すバナーを出す。
 * ProgramRunner が子 iframe をプローブしており、子のイベントループが詰まっているときは
 * ping に pong しない（親は動いているため、ブリッジで判定）。
 * タブがバックグラウンドの間はワーカー側で監視を一時停止する。
 */
export function MainThreadWatchdog() {
  const workerRef = useRef<Worker | null>(null);
  const [bannerOpen, setBannerOpen] = useState(false);

  useEffect(() => {
    const worker = new Worker("/main-thread-monitor.worker.js");
    workerRef.current = worker;

    worker.onmessage = (ev: MessageEvent<{ type: string }>) => {
      const { type } = ev.data ?? {};
      if (type === "ping") {
        if (isWatchdogPingAllowed()) {
          worker.postMessage({ type: "pong" });
        }
        return;
      }
      if (type === "stalled") {
        if (document.visibilityState !== "hidden") {
          setBannerOpen(true);
        }
      }
    };

    const syncVisibility = () => {
      if (document.visibilityState === "hidden") {
        worker.postMessage({ type: "pause" });
      } else {
        worker.postMessage({ type: "resume" });
      }
    };

    document.addEventListener("visibilitychange", syncVisibility);
    syncVisibility();

    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  if (!bannerOpen) return null;

  return (
    <div
      role="alert"
      className="mainThreadWatchdogBanner"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        padding: "12px 16px",
        background: "var(--panel)",
        color: "#f9fafb",
        borderTop: "1px solid var(--panel-border)",
        fontSize: "0.875rem",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "12px",
        justifyContent: "space-between",
      }}
    >
      <span>
        メインスレッドが約 3 秒以上応答していません。表示や操作がおかしい場合はページを再読み込みしてください。
      </span>
      <span style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: "6px 12px",
            borderRadius: "6px",
            border: "none",
            background: "var(--orange)",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          再読み込み
        </button>
        <button
          type="button"
          onClick={() => setBannerOpen(false)}
          style={{
            padding: "6px 12px",
            borderRadius: "6px",
            border: "1px solid var(--panel-border)",
            background: "transparent",
            color: "#f9fafb",
            cursor: "pointer",
          }}
        >
          閉じる
        </button>
      </span>
    </div>
  );
}
