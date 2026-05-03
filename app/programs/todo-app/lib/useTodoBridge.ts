"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ApiPayload } from "./todoModel";

/** 親がプライバシー解除後にリプレイした応答など、pending が無いときに同期する */
export const RUNNER_BRIDGE_DATA_EVENT = "runner-bridge-data";

type Pending = {
  cb: (err: Error | null, data: ApiPayload | null) => void;
} | null;

/**
 * 親ランナーからの postMessage かどうか。
 * iframe 内では親 window が別レルムのため `ev.source instanceof Window` が **false** になり得る。
 * MessagePort / ServiceWorker は除外し、オリジンは親子で一致するケースだけ受理する。
 */
function isBridgeReplyFromRunner(ev: MessageEvent): boolean {
  if (typeof window === "undefined" || window.parent === window) return false;
  if (
    typeof ev.origin !== "string" ||
    ev.origin !== window.location.origin
  ) {
    return false;
  }
  const src = ev.source;
  if (src === null || src === window) return false;
  if (typeof MessagePort !== "undefined" && src instanceof MessagePort) {
    return false;
  }
  if (
    typeof ServiceWorker !== "undefined" &&
    src instanceof ServiceWorker
  ) {
    return false;
  }
  return true;
}

/**
 * 親からの runner-data 応答かどうか。
 * - 成功: `{ content: object | null }`（GET は API が正規化）
 * - 失敗: `error` が真（boolean / string。親の postBackToChild は body の error 文字列で true を上書きし得る）
 */
function isRunnerBridgeReply(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const o = data as { error?: unknown; content?: unknown };
  if ("error" in o && o.error != null && o.error !== false) return true;
  if (!("content" in o)) return false;
  const c = o.content;
  return (
    c === null || (typeof c === "object" && !Array.isArray(c))
  );
}

/**
 * 親ランナーとの postMessage（api_id:1 読込 / api_id:2 保存）。
 * 親・子とも enqueue で直列化。応答は runner の payload 形だけ受理し、それ以外は無視する。
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
      if (!isBridgeReplyFromRunner(ev)) return;
      const d = ev.data;
      const pr = pendingRef.current;
      if (!pr) {
        if (!isRunnerBridgeReply(d)) return;
        const ghost = d as {
          error?: unknown;
          message?: string;
          content?: unknown;
        };
        if (
          "error" in ghost &&
          ghost.error != null &&
          ghost.error !== false
        ) {
          return;
        }
        window.dispatchEvent(
          new CustomEvent(RUNNER_BRIDGE_DATA_EVENT, {
            detail: d as ApiPayload,
          })
        );
        return;
      }
      if (!isRunnerBridgeReply(d)) return;

      const finish = (err: Error | null, data: ApiPayload | null) => {
        if (pendingRef.current !== pr) return;
        pendingRef.current = null;
        pr.cb(err, data);
      };

      const payload = d as {
        error?: unknown;
        message?: string;
        content?: unknown;
      };

      if ("error" in payload && payload.error != null && payload.error !== false) {
        let msg: string;
        if (typeof payload.message === "string") msg = payload.message;
        else if (payload.error === true) msg = "error";
        else msg = String(payload.error);
        finish(new Error(msg), null);
        return;
      }

      finish(null, d as ApiPayload);
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
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
        pendingRef.current = {
          cb: (err, data) => {
            if (err) {
              reject(err);
              return;
            }
            resolve(data ?? { content: {} });
          },
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
          pendingRef.current = {
            cb: (err, data) => {
              if (err) {
                reject(err);
                return;
              }
              resolve(data ?? { content: {} });
            },
          };
          window.parent.postMessage(
            { api_id: 2, content: contentObject },
            "*"
          );
        });
      });
    },
    [enqueue, hasParent]
  );

  return { requestRead, requestSave, hasParent };
}
