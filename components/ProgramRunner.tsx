"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { PrivacyModeToggle } from "@/components/PrivacyModeToggle";
import { registerWatchdogPingAllowedGetter } from "@/lib/mainThreadWatchdogBridge";

export type ChildProgram = {
  id: string;
  label: string;
  path: string;
  iframeTitle: string;
};

const childReplyTarget = "*";
const maxEntries = 200;

const DIRECTORY_ESCAPE_WARNING =
  "不正なパスにリダイレクトしています。作成したプログラムの範囲外へのリダイレクトは許可されていません。";

/** 子フレームに postMessage ハートビートは送らず、子の `setTimeout(0)` が実行されるかだけ見る */
const CHILD_EVENT_LOOP_PROBE_INTERVAL_MS = 1500;
const CHILD_EVENT_LOOP_PROBE_TIMEOUT_MS = 3000;

/** 子プローブ応答が無いとみなすまで（これを過ぎたら死活監視は pong しない） */
const WATCHDOG_CHILD_PROBE_STUCK_MS = 800;
/** 最後の子プローブ成功からの経過がこれを超えたら pong を止める */
const WATCHDOG_CHILD_JANK_STALE_MS = 3500;

const JANK_PONG_TYPE = "__runner_jank_pong" as const;

const CHILD_THREAD_JANK_MESSAGE =
  "プログラム（iframe）のメインスレッドが3秒以上応答しませんでした。無限ループなどで重くなっている可能性があるため、表示（iframe）を停止しました。";

/** 子 iframe からの postMessage がこの回数以上 / この時間窓なら負荷警告 */
const CHILD_POST_MESSAGE_RATE_WINDOW_MS = 1000;
const CHILD_POST_MESSAGE_RATE_THRESHOLD = 20;

const POST_MESSAGE_FLOOD_WARNING =
  "1 秒間に " +
  String(CHILD_POST_MESSAGE_RATE_THRESHOLD) +
  " 回以上の postMessage を受信しました。過剰な通信の可能性があります。";

/** 子からの 1 件の postMessage 推定サイズがこれ以上なら警告（UTF-8 換算の近似） */
const CHILD_POST_MESSAGE_SIZE_THRESHOLD_BYTES = 64 * 1024;

const postMessageSizeEncoder = new TextEncoder();

/**
 * `postMessage` で渡された `data` のおおよそのバイト数（構造化クローン厳密一致ではない）。
 * JSON 化できないオブジェクトは 0 として扱い、過大評価による誤警告を避ける。
 */
function estimatePostMessagePayloadBytes(data: unknown): number {
  if (data == null) return 0;
  if (typeof data === "string") {
    return postMessageSizeEncoder.encode(data).length;
  }
  if (typeof data === "number" || typeof data === "boolean") return 8;
  if (typeof data === "bigint") return 32;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (data instanceof Blob) return data.size;
  if (typeof data === "object") {
    try {
      return postMessageSizeEncoder.encode(JSON.stringify(data)).length;
    } catch {
      return 0;
    }
  }
  return postMessageSizeEncoder.encode(String(data)).length;
}

function safeDecodePathnameSegment(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/** `selected.path` から許可ディレクトリの pathname プレフィックス（末尾 `/`）を得る */
function programDirectoryPrefixFromPath(pathFromSelected: string): string {
  const pathname = new URL(pathFromSelected, "http://localhost").pathname;
  const decoded = safeDecodePathnameSegment(pathname);
  return decoded.endsWith("/") ? decoded : decoded + "/";
}

/** iframe の pathname が、当該プログラムの `/programs/<id>/` 配下か（同一も可） */
function isIframePathWithinProgramRoot(
  iframePathname: string,
  programPathFromSelected: string
): boolean {
  const root = programDirectoryPrefixFromPath(programPathFromSelected);
  const base = root.slice(0, -1);
  const decoded = safeDecodePathnameSegment(iframePathname);
  if (decoded === base) return true;
  return decoded.startsWith(root);
}

/** program-ec-frontend の ProgramIframeBridge と同じ応答（子の api 1/2 をブロック） */
const PRIVACY_MODE_RESPONSE = {
  error: true,
  status: 403,
  message: "privacy_mode",
} as const;

type PrivacyReplayItem =
  | { api_id: 1; content: null }
  | { api_id: 2; content: Record<string, unknown> };

function findProgramById(
  programs: ChildProgram[],
  id: string | null
): ChildProgram | null {
  if (programs.length === 0) return null;
  if (id) {
    const hit = programs.find((p) => p.id === id);
    if (hit) return hit;
  }
  return programs[0] ?? null;
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

function formatTime(d: Date): string {
  return (
    pad2(d.getHours()) +
    ":" +
    pad2(d.getMinutes()) +
    ":" +
    pad2(d.getSeconds()) +
    "." +
    String(d.getMilliseconds()).padStart(3, "0")
  );
}

/** 巨大な postMessage をログにそのまま出すと固まるため切り詰める */
const LOG_DATA_MAX_CHARS = 4000;

function stringifyForLog(data: unknown): string {
  try {
    const s = JSON.stringify(data);
    if (s.length <= LOG_DATA_MAX_CHARS) return s;
    return (
      s.slice(0, LOG_DATA_MAX_CHARS) +
      "… （省略、全長 " +
      s.length +
      " 文字）"
    );
  } catch {
    return String(data);
  }
}

function isApi042(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { api_id?: number; content?: unknown }).api_id === 1 &&
    (data as { content?: unknown }).content === null
  );
}

function isApi043(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const o = data as { api_id?: number; content?: unknown };
  if (o.api_id !== 2 || !("content" in o)) return false;
  const c = o.content;
  return typeof c === "object" && c !== null && !Array.isArray(c);
}

function isRunUserLogicRequest(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const o = data as { api_id?: number; content?: unknown };
  if (o.api_id !== 3) return false;
  const c = o.content;
  if (typeof c !== "object" || c === null || Array.isArray(c)) return false;
  return typeof (c as { code?: unknown }).code === "string";
}

function createSecureWorkerBlob(userCode: string): Blob {
  const head =
    "(function() {\n" +
    "  var forbidden = ['Worker', 'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts'];\n" +
    "  forbidden.forEach(function(prop) {\n" +
    "    Object.defineProperty(self, prop, {\n" +
    "      value: undefined,\n" +
    "      writable: false,\n" +
    "      configurable: false\n" +
    "    });\n" +
    "  });\n" +
    "  self.onmessage = function(event) {\n" +
    "    try {\n" +
    "      var result = (function() {\n";
  const tail =
    "      })();\n" +
    "      postMessage(result);\n" +
    "    } catch (err) {\n" +
    "      postMessage({\n" +
    "        type: 'error',\n" +
    "        data: err && err.message ? String(err.message) : String(err)\n" +
    "      });\n" +
    "    }\n" +
    "  };\n" +
    "})();\n";
  return new Blob([head + userCode + tail], {
    type: "application/javascript",
  });
}

function runUserLogic(userCode: string): Promise<unknown> {
  return new Promise(function (resolve, reject) {
    const blob = createSecureWorkerBlob(userCode);
    const workerURL = URL.createObjectURL(blob);
    const worker = new Worker(workerURL);
    const timeout = setTimeout(function () {
      worker.terminate();
      URL.revokeObjectURL(workerURL);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("progenjoy-program-worker-stalled"));
      }
      reject(new Error("Timeout"));
    }, 3000);
    worker.onmessage = function (e) {
      clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(workerURL);
      const d = e.data as { type?: string; data?: unknown };
      if (
        d &&
        typeof d === "object" &&
        d !== null &&
        "type" in d &&
        d.type === "error"
      ) {
        reject(
          new Error(typeof d.data === "string" ? d.data : "Worker error")
        );
        return;
      }
      resolve(d);
    };
    worker.onerror = function (err) {
      clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(workerURL);
      reject(err);
    };
    worker.postMessage(undefined);
  });
}

function postBackToChild(
  source: Window,
  res: Response,
  body: unknown
): void {
  let payload: unknown;
  if (!res.ok) {
    payload = Object.assign(
      { error: true, status: res.status },
      body && typeof body === "object" ? (body as object) : {}
    );
  } else {
    payload = body;
  }
  source.postMessage(payload, childReplyTarget);
}

export function ProgramRunner() {
  const searchParams = useSearchParams();
  const name = searchParams.get("name");

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const logListRef = useRef<HTMLUListElement>(null);
  const logEmptyRef = useRef<HTMLParagraphElement>(null);
  const bridgeBusyRef = useRef(false);
  const workerBusyRef = useRef(false);
  /** postMessage ハンドラはクロージャが古いままになりがちなので、常に最新の programId を参照する */
  const selectedProgramIdRef = useRef<string | null>(null);
  /** iframe の src と同じ基準で許可ルートを onLoad 時に照合する */
  const selectedProgramPathRef = useRef<string>("/programs/todo-app");

  const [programs, setPrograms] = useState<ChildProgram[] | null>(null);
  const [selected, setSelected] = useState<ChildProgram | null>(null);
  const [expanded, setExpanded] = useState(false);
  /** iframe プレビュー: ワイド（16:10）／スマホ風ランドスケープ（19.5:9） */
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">(
    "desktop"
  );
  const [privacyMode, setPrivacyMode] = useState(false);
  const [showPrivacyBlockedWarning, setShowPrivacyBlockedWarning] =
    useState(false);
  /** 非 null のときディレクトリ警告を表示。値は不正な遷移先の絶対パス（`location.href`）または取得不可の説明 */
  const [directoryEscapeAbsoluteUrl, setDirectoryEscapeAbsoluteUrl] =
    useState<string | null>(null);
  /** iframe を止めたときの説明（監視ページのみで検知したメインスレッド重さ） */
  const [iframeSuspendedMessage, setIframeSuspendedMessage] = useState<
    string | null
  >(null);
  const [showPostMessageFloodWarning, setShowPostMessageFloodWarning] =
    useState(false);
  /** 非 null のとき大きすぎる postMessage 警告を表示。値は推定バイト数 */
  const [postMessageOversizeBytes, setPostMessageOversizeBytes] = useState<
    number | null
  >(null);
  /** 応答不能検知後に iframe を `about:blank` に固定（React の src と整合させる） */
  const [iframeSrcOverride, setIframeSrcOverride] = useState<string | null>(
    null
  );
  const iframeSrcOverrideRef = useRef(iframeSrcOverride);
  iframeSrcOverrideRef.current = iframeSrcOverride;
  const iframeAlreadySuspendedRef = useRef(false);
  /** 子のイベントループ応答待ち（postMessage ではなく子側 setTimeout(0) の実行結果で判定） */
  const childProbeNonceRef = useRef<string | null>(null);
  /** 子プローブ送信時刻（nonce とセットで死活監視が詰まり判定に使う） */
  const childProbeStartedAtRef = useRef<number | null>(null);
  /** 子から __runner_jank_pong を最後に受け取った時刻 */
  const lastChildJankPongAtRef = useRef(Date.now());
  /** ブラウザのタイマー ID（Node の `Timeout` 型と衝突しないよう number） */
  const childProbeTimeoutRef = useRef<number | null>(null);
  /** 子からの postMessage 受信時刻（内部プローブ除く・レート検知用） */
  const childPostMessageTimestampsRef = useRef<number[]>([]);
  const privacyReplayQueueRef = useRef<PrivacyReplayItem[]>([]);
  const prevPrivacyModeRef = useRef<boolean | null>(null);
  const privacyModeRef = useRef(false);
  const [qualityBusy, setQualityBusy] = useState(false);
  const [qualityFailed, setQualityFailed] = useState(false);
  /** 並走する品質チェックのうち最新以外は結果を無視する */
  const qualityRequestIdRef = useRef(0);

  const clearLog = useCallback(() => {
    const logList = logListRef.current;
    const logEmpty = logEmptyRef.current;
    if (logList) logList.innerHTML = "";
    if (logEmpty) logEmpty.hidden = false;
    if (logList) logList.hidden = true;
  }, []);

  const appendLog = useCallback(
    (direction: "in" | "out", message: string, data?: unknown) => {
      const logList = logListRef.current;
      const logEmpty = logEmptyRef.current;
      if (!logList || !logEmpty) return;
      logEmpty.hidden = true;
      logList.hidden = false;
      const li = document.createElement("li");
      const t = document.createElement("span");
      t.className = "logTime";
      t.textContent = formatTime(new Date());
      li.appendChild(t);
      const dir = document.createElement("span");
      dir.className = direction === "in" ? "logDirIn" : "logDirOut";
      dir.textContent = "[" + direction + "] ";
      li.appendChild(dir);
      li.appendChild(document.createTextNode(message));
      if (data !== undefined) {
        const pre = document.createElement("span");
        pre.className = "logData";
        try {
          pre.textContent = stringifyForLog(data);
        } catch {
          pre.textContent = String(data);
        }
        li.appendChild(pre);
      }
      logList.appendChild(li);
      while (logList.children.length > maxEntries) {
        logList.removeChild(logList.firstChild!);
      }
      li.scrollIntoView({ block: "nearest" });
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    const programFromUrl = new URLSearchParams(window.location.search).get(
      "program"
    );
    void (async () => {
      try {
        const r = await fetch("/api/child-programs", {
          credentials: "same-origin",
        });
        if (!r.ok) throw new Error("bad status");
        const j = (await r.json()) as { programs?: ChildProgram[] };
        const list = Array.isArray(j.programs) ? j.programs : [];
        if (!cancelled) {
          setPrograms(list);
          setSelected(
            list.length > 0 ? findProgramById(list, programFromUrl) : null
          );
        }
      } catch {
        if (!cancelled) {
          setPrograms([]);
          setSelected(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    selectedProgramIdRef.current = selected?.id ?? null;
  }, [selected?.id]);

  useEffect(() => {
    selectedProgramPathRef.current =
      selected?.path ?? "/programs/todo-app";
  }, [selected?.path]);

  useEffect(() => {
    setDirectoryEscapeAbsoluteUrl(null);
    iframeAlreadySuspendedRef.current = false;
    setIframeSrcOverride(null);
    setIframeSuspendedMessage(null);
    setShowPostMessageFloodWarning(false);
    setPostMessageOversizeBytes(null);
    childPostMessageTimestampsRef.current = [];
    lastChildJankPongAtRef.current = Date.now();
  }, [selected?.path]);

  useEffect(() => {
    const getter = (): boolean => {
      if (iframeSrcOverrideRef.current === "about:blank") return true;
      const cw = iframeRef.current?.contentWindow;
      if (!cw) return true;

      const pending = childProbeNonceRef.current;
      const started = childProbeStartedAtRef.current;
      if (
        pending !== null &&
        started !== null &&
        Date.now() - started >= WATCHDOG_CHILD_PROBE_STUCK_MS
      ) {
        return false;
      }
      return (
        Date.now() - lastChildJankPongAtRef.current <
        WATCHDOG_CHILD_JANK_STALE_MS
      );
    };
    return registerWatchdogPingAllowedGetter(getter);
  }, []);

  const suspendProgramIframe = useCallback((reason: string) => {
    if (iframeAlreadySuspendedRef.current) return;
    iframeAlreadySuspendedRef.current = true;
    if (childProbeTimeoutRef.current !== null) {
      clearTimeout(childProbeTimeoutRef.current);
      childProbeTimeoutRef.current = null;
    }
    childProbeNonceRef.current = null;
    childProbeStartedAtRef.current = null;
    setDirectoryEscapeAbsoluteUrl(null);
    setShowPostMessageFloodWarning(false);
    setPostMessageOversizeBytes(null);
    childPostMessageTimestampsRef.current = [];
    setIframeSrcOverride("about:blank");
    setIframeSuspendedMessage(reason);
  }, []);

  /**
   * 子フレームのキューに `setTimeout(0)` を積むだけ（子プログラムのコード変更や postMessage ハートビート不要）。
   * 無限ループで子のメインスレッドが詰まるとコールバックが走らず、親がタイムアウトで検知する。
   */
  useEffect(() => {
    if (iframeSrcOverride === "about:blank") return;

    const scheduleProbe = () => {
      if (iframeAlreadySuspendedRef.current) return;
      const iframe = iframeRef.current;
      const cw = iframe?.contentWindow;
      if (!cw || childProbeNonceRef.current !== null) return;

      const nonce = crypto.randomUUID();
      childProbeNonceRef.current = nonce;
      childProbeStartedAtRef.current = Date.now();
      const tid = window.setTimeout(() => {
        childProbeTimeoutRef.current = null;
        if (childProbeNonceRef.current === nonce) {
          childProbeNonceRef.current = null;
          childProbeStartedAtRef.current = null;
          suspendProgramIframe(CHILD_THREAD_JANK_MESSAGE);
        }
      }, CHILD_EVENT_LOOP_PROBE_TIMEOUT_MS);
      childProbeTimeoutRef.current = tid as unknown as number;

      try {
        // 子のレルムで実行されるコード文字列（CSP で禁止される環境では検知を諦める）
        // eslint-disable-next-line no-implied-eval -- 子 iframe のイベントループ生存確認専用
        cw.setTimeout(
          "window.parent.postMessage({type:\"" +
            JANK_PONG_TYPE +
            "\",nonce:\"" +
            nonce +
            "\"},\"*\");",
          0
        );
      } catch {
        if (childProbeTimeoutRef.current !== null) {
          clearTimeout(childProbeTimeoutRef.current);
          childProbeTimeoutRef.current = null;
        }
        childProbeNonceRef.current = null;
        childProbeStartedAtRef.current = null;
      }
    };

    let intervalId: number | null = null;

    const stopProbe = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
      if (childProbeTimeoutRef.current !== null) {
        clearTimeout(childProbeTimeoutRef.current);
        childProbeTimeoutRef.current = null;
      }
      childProbeNonceRef.current = null;
      childProbeStartedAtRef.current = null;
    };

    const startProbe = () => {
      if (intervalId !== null) return;
      intervalId = window.setInterval(
        scheduleProbe,
        CHILD_EVENT_LOOP_PROBE_INTERVAL_MS
      );
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stopProbe();
        return;
      }
      startProbe();
      scheduleProbe();
    };

    if (document.visibilityState !== "hidden") {
      startProbe();
      scheduleProbe();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopProbe();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [selected?.path, iframeSrcOverride, suspendProgramIframe]);

  useEffect(() => {
    privacyModeRef.current = privacyMode;
  }, [privacyMode]);

  useEffect(() => {
    privacyReplayQueueRef.current = [];
  }, [selected?.id]);

  const onPrivacyModeChange = useCallback((next: boolean) => {
    setPrivacyMode(next);
    if (!next) {
      setShowPrivacyBlockedWarning(false);
    }
  }, []);

  useEffect(() => {
    const prev = prevPrivacyModeRef.current;
    prevPrivacyModeRef.current = privacyMode;

    if (prev === null) return;
    if (prev !== true || privacyMode !== false) return;
    if (privacyReplayQueueRef.current.length === 0) return;

    const queue = [...privacyReplayQueueRef.current];
    privacyReplayQueueRef.current = [];

    const programId = selectedProgramIdRef.current;
    const cw = iframeRef.current?.contentWindow;
    if (!programId || !cw) return;

    void (async () => {
      for (const item of queue) {
        try {
          if (item.api_id === 1) {
            const url =
              "/api/runner-data/" + encodeURIComponent(programId);
            const res = await fetch(url, {
              credentials: "same-origin",
            });
            const body = await res.json().catch(() => ({}));
            appendLog(
              "out",
              "api_id:1 privacy replay → data/" + programId + "/data.json 読込",
              body
            );
            postBackToChild(cw, res, body);
          } else {
            const url =
              "/api/runner-data/" + encodeURIComponent(programId);
            const res = await fetch(url, {
              method: "PUT",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content: item.content }),
            });
            const body = await res.json().catch(() => ({}));
            appendLog(
              "out",
              "api_id:2 privacy replay → data/" + programId + "/data.json 保存",
              body
            );
            postBackToChild(cw, res, body);
          }
        } catch (err) {
          appendLog("out", "privacy replay network_error", String(err));
          cw.postMessage(
            { error: true, status: 500, message: "network_error" },
            childReplyTarget
          );
        }
      }
    })();
  }, [privacyMode, appendLog]);

  const applyTitle = useCallback(() => {
    const iframe = iframeRef.current;
    if (!selected || !iframe) return;
    if (name) {
      document.title = "プログラムテスト | " + name;
      iframe.title = name;
    } else {
      document.title = "プログラムテスト | ローカルランナー";
      iframe.title = selected.iframeTitle;
    }
  }, [name, selected]);

  useEffect(() => {
    applyTitle();
  }, [applyTitle]);

  const setProgramQueryInUrl = useCallback((id: string) => {
    const u = new URL(window.location.href);
    u.searchParams.set("program", id);
    history.replaceState(null, "", u.pathname + u.search);
  }, []);

  const onSelectChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!programs) return;
      const next = findProgramById(programs, e.target.value);
      if (!next) return;
      setSelected(next);
      setProgramQueryInUrl(next.id);
      clearLog();
      iframeAlreadySuspendedRef.current = false;
      setIframeSrcOverride(null);
      setIframeSuspendedMessage(null);
      setDirectoryEscapeAbsoluteUrl(null);
      setShowPostMessageFloodWarning(false);
      setPostMessageOversizeBytes(null);
      childPostMessageTimestampsRef.current = [];
    },
    [programs, clearLog, setProgramQueryInUrl]
  );

  const executeProgramQualityCheck = useCallback(
    async (programId: string, trigger: "manual" | "auto") => {
      const requestId = ++qualityRequestIdRef.current;
      setQualityBusy(true);
      setQualityFailed(false);
      try {
        const res = await fetch("/api/program-quality", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ programId }),
        });
        const j = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          summary?: string;
          sourcePath?: string;
          eslint?: { ok?: boolean; exitCode?: number };
          prettier?: { ok?: boolean; exitCode?: number };
        };
        if (requestId !== qualityRequestIdRef.current) return;

        const prefix = trigger === "auto" ? "[自動] " : "";

        if (!res.ok) {
          setQualityFailed(true);
          appendLog(
            "out",
            prefix +
              "program-quality: HTTP " +
              res.status +
              " " +
              (j.error ?? ""),
            j
          );
          return;
        }
        const summaryLine =
          prefix +
          "program-quality program=" +
          programId +
          " path=" +
          (j.sourcePath ?? "?") +
          " → " +
          (j.summary ?? "（要約なし）");
        setQualityFailed(j.ok !== true);
        appendLog("out", summaryLine, j);
      } catch (err) {
        if (requestId !== qualityRequestIdRef.current) return;
        setQualityFailed(true);
        appendLog(
          "out",
          (trigger === "auto" ? "[自動] " : "") +
            "program-quality network_error",
          String(err)
        );
      } finally {
        if (requestId === qualityRequestIdRef.current) {
          setQualityBusy(false);
        }
      }
    },
    [appendLog]
  );

  const runProgramQuality = useCallback(() => {
    const programId = selectedProgramIdRef.current;
    if (!programId) {
      appendLog("out", "program-quality: program 未選択", null);
      return;
    }
    void executeProgramQualityCheck(programId, "manual");
  }, [appendLog, executeProgramQualityCheck]);

  useEffect(() => {
    const programId = selected?.id ?? null;
    if (!programId) return;
    if (iframeSrcOverride !== null) return;

    void executeProgramQualityCheck(programId, "auto");
  }, [selected?.id, iframeSrcOverride, executeProgramQualityCheck]);

  const onIframeLoad = useCallback(() => {
    if (iframeAlreadySuspendedRef.current) return;
    const iframe = iframeRef.current;
    const programPath = selectedProgramPathRef.current;
    if (!iframe || !programPath) return;
    try {
      const href = iframe.contentWindow?.location.href ?? "";
      if (href === "about:blank" || href.startsWith("about:")) return;
      const cw = iframe.contentWindow;
      if (!cw) return;
      const pathname = cw.location.pathname;
      if (!isIframePathWithinProgramRoot(pathname, programPath)) {
        setDirectoryEscapeAbsoluteUrl(cw.location.href);
      } else {
        setDirectoryEscapeAbsoluteUrl(null);
        lastChildJankPongAtRef.current = Date.now();
      }
    } catch {
      setDirectoryEscapeAbsoluteUrl(
        "（取得不可: 別オリジンへ遷移したなどの理由で iframe の表示 URL を参照できません）"
      );
    }
  }, []);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const cw = iframeRef.current?.contentWindow;
      if (ev.source !== cw) return;

      if (
        typeof ev.data === "object" &&
        ev.data !== null &&
        (ev.data as { type?: string }).type === JANK_PONG_TYPE
      ) {
        const nonce = (ev.data as { nonce?: unknown }).nonce;
        if (
          typeof nonce === "string" &&
          nonce === childProbeNonceRef.current
        ) {
          childProbeNonceRef.current = null;
          childProbeStartedAtRef.current = null;
          lastChildJankPongAtRef.current = Date.now();
          if (childProbeTimeoutRef.current !== null) {
            clearTimeout(childProbeTimeoutRef.current);
            childProbeTimeoutRef.current = null;
          }
        }
        return;
      }

      const now = performance.now();
      const ts = childPostMessageTimestampsRef.current;
      ts.push(now);
      const cutoff = now - CHILD_POST_MESSAGE_RATE_WINDOW_MS;
      let drop = 0;
      while (drop < ts.length && ts[drop]! < cutoff) drop++;
      if (drop > 0) ts.splice(0, drop);
      if (ts.length >= CHILD_POST_MESSAGE_RATE_THRESHOLD) {
        setShowPostMessageFloodWarning(true);
      }

      const payloadBytes = estimatePostMessagePayloadBytes(ev.data);
      if (payloadBytes >= CHILD_POST_MESSAGE_SIZE_THRESHOLD_BYTES) {
        setPostMessageOversizeBytes(payloadBytes);
      }

      appendLog("in", "postMessage received", ev.data);

      if (isApi042(ev.data)) {
        if (privacyModeRef.current) {
          privacyReplayQueueRef.current.push({ api_id: 1, content: null });
          setShowPrivacyBlockedWarning(true);
          appendLog(
            "out",
            "api_id:1 → blocked (privacy mode)",
            PRIVACY_MODE_RESPONSE
          );
          (ev.source as Window).postMessage(
            PRIVACY_MODE_RESPONSE,
            childReplyTarget
          );
          return;
        }
        const programId = selectedProgramIdRef.current;
        if (!programId) {
          appendLog("out", "api_id:1 → program 未選択", null);
          (ev.source as Window).postMessage(
            { error: true, status: 400, message: "no_program_selected" },
            childReplyTarget
          );
          return;
        }
        if (bridgeBusyRef.current) return;
        bridgeBusyRef.current = true;
        void (async () => {
          try {
            const url =
              "/api/runner-data/" + encodeURIComponent(programId);
            const res = await fetch(url, {
              credentials: "same-origin",
            });
            const body = await res.json().catch(() => ({}));
            appendLog(
              "out",
              "api_id:1 → data/" + programId + "/data.json 読込",
              body
            );
            postBackToChild(ev.source as Window, res, body);
          } catch (err) {
            appendLog("out", "api_id:1 network_error", String(err));
            (ev.source as Window).postMessage(
              { error: true, status: 500, message: "network_error" },
              childReplyTarget
            );
          } finally {
            bridgeBusyRef.current = false;
          }
        })();
        return;
      }

      if (isRunUserLogicRequest(ev.data)) {
        if (workerBusyRef.current) {
          const outBusy = {
            api_id: 3,
            content: { error: "worker_busy: 前の実行が完了するまで待ってください" },
          };
          appendLog("out", "api_id:3 → worker busy", outBusy);
          (ev.source as Window).postMessage(outBusy, childReplyTarget);
          return;
        }
        workerBusyRef.current = true;
        void (async () => {
          try {
            const data = ev.data as { content: { code: string } };
            const result = await runUserLogic(data.content.code);
            const out = { api_id: 3, content: { result } };
            appendLog("out", "api_id:3 → worker OK", out);
            (ev.source as Window).postMessage(out, childReplyTarget);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const outErr = { api_id: 3, content: { error: msg } };
            appendLog("out", "api_id:3 → worker error", outErr);
            (ev.source as Window).postMessage(outErr, childReplyTarget);
          } finally {
            workerBusyRef.current = false;
          }
        })();
        return;
      }

      if (isApi043(ev.data)) {
        if (privacyModeRef.current) {
          const data = ev.data as { content: Record<string, unknown> };
          privacyReplayQueueRef.current.push({
            api_id: 2,
            content: data.content,
          });
          setShowPrivacyBlockedWarning(true);
          appendLog(
            "out",
            "api_id:2 → blocked (privacy mode)",
            PRIVACY_MODE_RESPONSE
          );
          (ev.source as Window).postMessage(
            PRIVACY_MODE_RESPONSE,
            childReplyTarget
          );
          return;
        }
        const programId = selectedProgramIdRef.current;
        if (!programId) {
          appendLog("out", "api_id:2 → program 未選択", null);
          (ev.source as Window).postMessage(
            { error: true, status: 400, message: "no_program_selected" },
            childReplyTarget
          );
          return;
        }
        if (bridgeBusyRef.current) return;
        bridgeBusyRef.current = true;
        void (async () => {
          try {
            const data = ev.data as { content: Record<string, unknown> };
            const url =
              "/api/runner-data/" + encodeURIComponent(programId);
            const res = await fetch(url, {
              method: "PUT",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content: data.content }),
            });
            const body = await res.json().catch(() => ({}));
            appendLog(
              "out",
              "api_id:2 → data/" + programId + "/data.json 保存",
              body
            );
            postBackToChild(ev.source as Window, res, body);
          } catch (err) {
            appendLog("out", "api_id:2 network_error", String(err));
            (ev.source as Window).postMessage(
              { error: true, status: 500, message: "network_error" },
              childReplyTarget
            );
          } finally {
            bridgeBusyRef.current = false;
          }
        })();
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [appendLog]);

  const toggleFs = useCallback(() => {
    setExpanded((e) => {
      const next = !e;
      document.body.style.overflow = next ? "hidden" : "";
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && expanded) {
        setExpanded(false);
        document.body.style.overflow = "";
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded]);

  useEffect(() => {
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const pageHeading =
    name != null && name !== ""
      ? "プログラムテスト: " + name
      : selected
        ? "プログラムテスト: " + selected.label
        : "プログラムテスト";

  const iframeSrc =
    iframeSrcOverride !== null
      ? iframeSrcOverride
      : (selected?.path ?? "/programs/todo-app");

  return (
    <main className="main">
      <h1 className="pageTitle">{pageHeading}</h1>
      <p className="lead">
        iframe でプログラムを実行し、postMessage のやり取りをログで確認できます。
      </p>
      <p className="lead">
        <a href="#" onClick={(e) => e.preventDefault()}>
          投稿者向けの詳細（別タブで開く）
        </a>
        <span className="badgeLocal">Next.js</span>
      </p>

      <div className="programBar">
        <div className="programBarMain">
          <label htmlFor="program-select">表示するプログラム</label>
          <select
            id="program-select"
            disabled={!programs || !selected}
            value={selected?.id ?? ""}
            onChange={onSelectChange}
          >
            {!programs && <option value="">一覧を読み込み中…</option>}
            {programs && programs.length === 0 && (
              <option value="">一覧を取得できませんでした</option>
            )}
            {programs?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="programBarPreview">
          <span className="previewBarLabel" id="preview-mode-label">
            プレビュー
          </span>
          <div
            className="previewSwitchRow"
            role="group"
            aria-labelledby="preview-mode-label"
          >
            <span
              className={
                "previewSwitchCaption" +
                (previewMode === "desktop"
                  ? " previewSwitchCaptionActive"
                  : "")
              }
            >
              パソコン
            </span>
            <button
              type="button"
              className="previewSwitch"
              role="switch"
              aria-checked={previewMode === "mobile"}
              aria-label={
                previewMode === "mobile"
                  ? "スマホサイズのプレビュー（クリックでパソコン）"
                  : "パソコンサイズのプレビュー（クリックでスマホ）"
              }
              onClick={() =>
                setPreviewMode((m) => (m === "desktop" ? "mobile" : "desktop"))
              }
            >
              <span className="previewSwitchTrack" aria-hidden>
                <span className="previewSwitchThumb" />
              </span>
            </button>
            <span
              className={
                "previewSwitchCaption" +
                (previewMode === "mobile" ? " previewSwitchCaptionActive" : "")
              }
            >
              スマホ
            </span>
          </div>
        </div>
        <div className="programBarQuality">
          <span className="programBarQualityLabel">ソース品質</span>
          <button
            type="button"
            className={
              "programQualityBtn" + (qualityFailed ? " programQualityBtnDanger" : "")
            }
            disabled={!selected || qualityBusy || iframeSrcOverride !== null}
            onClick={() => void runProgramQuality()}
          >
            バリデーション
          </button>
          {qualityFailed && (
            <span className="programQualityWarn" role="alert">
              バリデーションに失敗しているため、このままではアップロードできません。詳細は通信ログを確認してください。
            </span>
          )}
          <p className="programBarQualityHint">
            表示中のプログラムに対し、複数のバリデーションを続けて実行します。結果は通信ログに表示されます。
          </p>
        </div>
      </div>

      <div className="grid">
        <div
          className={
            "privacyRunnerWrap" +
            (privacyMode ? " privacyRunnerWrapActive" : "")
          }
        >
          <div className="privacyRunnerToolbar">
            <PrivacyModeToggle
              enabled={privacyMode}
              onEnabledChange={onPrivacyModeChange}
            />
          </div>
          {showPrivacyBlockedWarning && (
            <div className="privacyBlockedBanner" role="alert">
              <p>プライバシーモードのため、データを保存できません。</p>
              <button
                type="button"
                className="privacyBlockedDismiss"
                onClick={() => setShowPrivacyBlockedWarning(false)}
              >
                閉じる
              </button>
            </div>
          )}
          {iframeSuspendedMessage != null && (
            <div
              className="privacyBlockedBanner mainThreadJankBanner"
              role="alert"
            >
              <p>{iframeSuspendedMessage}</p>
              <button
                type="button"
                className="privacyBlockedDismiss"
                onClick={() => setIframeSuspendedMessage(null)}
              >
                閉じる
              </button>
            </div>
          )}
          <div className="privacyRunnerInner">
            <div
              className={
                "runnerCard" +
                (previewMode === "mobile" ? " runnerCardMobilePreview" : "")
              }
            >
              <div
                className={
                  "viewport" +
                  (expanded ? " viewportExpanded" : "") +
                  (previewMode === "mobile" ? " viewportMobile" : "")
                }
              >
                <div className="viewportInner">
                  <iframe
                    ref={iframeRef}
                    src={iframeSrc}
                    title={selected?.iframeTitle ?? "program"}
                    sandbox="allow-scripts allow-same-origin"
                    onLoad={onIframeLoad}
                  />
                </div>
                {directoryEscapeAbsoluteUrl != null && (
                  <div className="directoryEscapeOverlay" role="alert">
                    <div className="directoryEscapeOverlayInner">
                      <p className="directoryEscapeOverlayText">
                        {DIRECTORY_ESCAPE_WARNING}
                      </p>
                      <p className="directoryEscapeOverlayPathLabel">
                        不正なリダイレクト先の絶対パス
                      </p>
                      <p className="directoryEscapeOverlayPathValue">
                        {directoryEscapeAbsoluteUrl}
                      </p>
                      <button
                        type="button"
                        className="directoryEscapeOverlayDismiss"
                        onClick={() => setDirectoryEscapeAbsoluteUrl(null)}
                      >
                        閉じる
                      </button>
                    </div>
                  </div>
                )}
                {showPostMessageFloodWarning && (
                  <div
                    className="directoryEscapeOverlay postMessageFloodOverlay"
                    role="alert"
                  >
                    <div className="directoryEscapeOverlayInner">
                      <p className="directoryEscapeOverlayText">
                        {POST_MESSAGE_FLOOD_WARNING}
                      </p>
                      <button
                        type="button"
                        className="directoryEscapeOverlayDismiss"
                        onClick={() => setShowPostMessageFloodWarning(false)}
                      >
                        閉じる
                      </button>
                    </div>
                  </div>
                )}
                {postMessageOversizeBytes != null && (
                  <div
                    className="directoryEscapeOverlay postMessageSizeOverlay"
                    role="alert"
                  >
                    <div className="directoryEscapeOverlayInner">
                      <p className="directoryEscapeOverlayText">
                        許容を超える大きさの postMessage
                        を受信しました（推定{" "}
                        {CHILD_POST_MESSAGE_SIZE_THRESHOLD_BYTES /
                          1024}{" "}
                        KiB 以上）。
                      </p>
                      <p className="directoryEscapeOverlayPathLabel">
                        推定ペイロードサイズ
                      </p>
                      <p className="directoryEscapeOverlayPathValue">
                        {postMessageOversizeBytes.toLocaleString("ja-JP")}{" "}
                        バイト（約{" "}
                        {(postMessageOversizeBytes / 1024).toFixed(1)}{" "}
                        KiB）
                      </p>
                      <button
                        type="button"
                        className="directoryEscapeOverlayDismiss"
                        onClick={() => setPostMessageOversizeBytes(null)}
                      >
                        閉じる
                      </button>
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  className="fsBtn"
                  onClick={toggleFs}
                  aria-label={
                    expanded
                      ? "プログラム表示を通常サイズに戻す"
                      : "プログラム表示を全画面にする"
                  }
                >
                  {expanded ? <FsIconCollapse /> : <FsIconExpand />}
                </button>
              </div>
            </div>
          </div>
        </div>

        <aside className="aside">
          <div className="logPanel">
            <div className="logHead">
              <h2>通信ログ</h2>
            </div>
            <div className="logBody">
              <p className="logEmpty" ref={logEmptyRef}>
                まだログはありません。プログラムが API
                を呼び出すとここに表示されます。
              </p>
              <ul className="logList" ref={logListRef} hidden />
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function FsIconExpand() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <polyline
        points="15 3 21 3 21 9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="9 21 3 21 3 15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="21" x2="14" y1="3" y2="10" strokeLinecap="round" />
      <line x1="3" x2="10" y1="21" y2="14" strokeLinecap="round" />
    </svg>
  );
}

function FsIconCollapse() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <polyline
        points="4 14 10 14 10 20"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="20 10 14 10 14 4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="14" x2="21" y1="10" y2="3" strokeLinecap="round" />
      <line x1="3" x2="10" y1="21" y2="14" strokeLinecap="round" />
    </svg>
  );
}
