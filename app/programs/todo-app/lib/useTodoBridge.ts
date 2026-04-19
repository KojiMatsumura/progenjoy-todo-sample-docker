"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ApiPayload } from "./todoModel";

type Pending = ((err: Error | null, data: ApiPayload | null) => void) | null;

/**
 * 親ランナーとの postMessage（api_id:1 読込 / api_id:2 保存）。
 * 親は同時に1リクエストのみ処理するためキューで直列化する。
 */
export function useTodoBridge() {
  const pendingRef = useRef<Pending>(null);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());

  const enqueue = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const p = chainRef.current.then(() => fn());
    chainRef.current = p.catch(() => {});
    return p;
  }, []);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== window.parent) return;
      const d = ev.data as { api_id?: number; error?: boolean; message?: string; content?: unknown };
      if (!pendingRef.current) return;
      if (d && d.api_id === 3) return;

      if (d && d.error) {
        const fn = pendingRef.current;
        pendingRef.current = null;
        fn(new Error(typeof d.message === "string" ? d.message : "error"), null);
        return;
      }

      if (d && typeof d.content === "object" && d.content !== null) {
        const cb = pendingRef.current;
        pendingRef.current = null;
        cb(null, d as ApiPayload);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const hasParent = useCallback(() => {
    return typeof window !== "undefined" && window.parent !== window;
  }, []);

  const requestRead = useCallback((): Promise<ApiPayload> => {
    return enqueue(() => {
      return new Promise((resolve, reject) => {
        if (!hasParent()) {
          reject(new Error("親フレームなし（単体では data に接続できません）"));
          return;
        }
        pendingRef.current = (err, data) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(data ?? { content: {} });
        };
        window.parent.postMessage({ api_id: 1, content: null }, "*");
      });
    });
  }, [enqueue, hasParent]);

  const requestSave = useCallback(
    (contentObject: Record<string, unknown>): Promise<ApiPayload> => {
      return enqueue(() => {
        return new Promise((resolve, reject) => {
          if (!hasParent()) {
            reject(new Error("親フレームなし"));
            return;
          }
          pendingRef.current = (err, data) => {
            if (err) {
              reject(err);
              return;
            }
            resolve(data ?? { content: {} });
          };
          window.parent.postMessage({ api_id: 2, content: contentObject }, "*");
        });
      });
    },
    [enqueue, hasParent]
  );

  return { requestRead, requestSave, hasParent };
}
