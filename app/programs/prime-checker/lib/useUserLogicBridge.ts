"use client";

import { useCallback, useEffect, useRef } from "react";

type PendingCb = ((err: Error | null, result: unknown) => void) | null;

/**
 * 親ランナーとの postMessage（api_id:3 でワーカー実行）。
 * 親は api 1/2 と独立して処理するが、子側は応答の取り違えを防ぐため直列化する。
 */
export function useUserLogicBridge() {
  const pendingRef = useRef<PendingCb>(null);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());

  const enqueue = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const p = chainRef.current.then(() => fn());
    chainRef.current = p.catch(() => {});
    return p;
  }, []);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== window.parent) return;
      if (!pendingRef.current) return;
      const d = ev.data as {
        api_id?: number;
        content?: { error?: string; result?: unknown };
      };
      if (d.api_id !== 3) return;

      const cb = pendingRef.current;
      pendingRef.current = null;
      const c = d.content;
      if (c && typeof c.error === "string") {
        cb(new Error(c.error), null);
        return;
      }
      if (c && "result" in c) {
        cb(null, c.result);
        return;
      }
      cb(new Error("不正な応答"), null);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const hasParent = useCallback(() => {
    return typeof window !== "undefined" && window.parent !== window;
  }, []);

  const runCode = useCallback(
    (code: string): Promise<unknown> => {
      return enqueue(() => {
        return new Promise((resolve, reject) => {
          if (!hasParent()) {
            reject(
              new Error(
                "親フレームなし（ランナーの iframe 内で開いてください）"
              )
            );
            return;
          }
          pendingRef.current = (err, result) => {
            if (err) reject(err);
            else resolve(result);
          };
          window.parent.postMessage({ api_id: 3, content: { code } }, "*");
        });
      });
    },
    [enqueue, hasParent]
  );

  return { runCode, hasParent };
}
