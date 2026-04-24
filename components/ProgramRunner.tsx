"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { PrivacyModeToggle } from "@/components/PrivacyModeToggle";

export type ChildProgram = {
  id: string;
  label: string;
  path: string;
  iframeTitle: string;
};

const FALLBACK_CHILD_PROGRAMS: ChildProgram[] = [
  {
    id: "todo-app",
    label: "TODO（/programs/todo-app/）",
    path: "/programs/todo-app/",
    iframeTitle: "TODO リスト",
  },
  {
    id: "prime-checker",
    label: "素数判定（/programs/prime-checker/）",
    path: "/programs/prime-checker/",
    iframeTitle: "素数判定",
  },
  {
    id: "debug-abuse",
    label: "不正行為テスト（/programs/debug-abuse/）",
    path: "/programs/debug-abuse/",
    iframeTitle: "不正行為テスト",
  },
];

const childReplyTarget = "*";
const maxEntries = 200;

const DIRECTORY_ESCAPE_WARNING =
  "不正なパスにリダイレクトしています。作成したプログラムの範囲外へのリダイレクトは許可されていません。";

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
): ChildProgram {
  if (id) {
    const hit = programs.find((p) => p.id === id);
    if (hit) return hit;
  }
  return programs[0]!;
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

function formatTime(d: Date): string {
  return (
    pad2(d.getUTCHours()) +
    ":" +
    pad2(d.getUTCMinutes()) +
    ":" +
    pad2(d.getUTCSeconds()) +
    "." +
    String(d.getUTCMilliseconds()).padStart(3, "0")
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
  /** postMessage ハンドラはクロージャが古いままになりがちなので、常に最新の programId を参照する */
  const selectedProgramIdRef = useRef<string | null>(null);
  /** iframe の src と同じ基準で許可ルートを onLoad 時に照合する */
  const selectedProgramPathRef = useRef<string>("/programs/todo-app/");

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
  const privacyReplayQueueRef = useRef<PrivacyReplayItem[]>([]);
  const prevPrivacyModeRef = useRef<boolean | null>(null);
  const privacyModeRef = useRef(false);

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
        if (
          cancelled ||
          !j.programs ||
          !Array.isArray(j.programs) ||
          !j.programs.length
        ) {
          if (!cancelled) {
            setPrograms(FALLBACK_CHILD_PROGRAMS);
            setSelected(
              findProgramById(FALLBACK_CHILD_PROGRAMS, programFromUrl)
            );
          }
          return;
        }
        if (!cancelled) {
          setPrograms(j.programs);
          setSelected(findProgramById(j.programs, programFromUrl));
        }
      } catch {
        if (!cancelled) {
          setPrograms(FALLBACK_CHILD_PROGRAMS);
          setSelected(
            findProgramById(FALLBACK_CHILD_PROGRAMS, programFromUrl)
          );
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
      selected?.path ?? "/programs/todo-app/";
  }, [selected?.path]);

  useEffect(() => {
    setDirectoryEscapeAbsoluteUrl(null);
  }, [selected?.path]);

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
      setSelected(next);
      setProgramQueryInUrl(next.id);
      clearLog();
    },
    [programs, clearLog, setProgramQueryInUrl]
  );

  const onIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    const programPath = selectedProgramPathRef.current;
    if (!iframe || !programPath) return;
    try {
      const cw = iframe.contentWindow;
      if (!cw) return;
      const pathname = cw.location.pathname;
      if (!isIframePathWithinProgramRoot(pathname, programPath)) {
        setDirectoryEscapeAbsoluteUrl(cw.location.href);
      } else {
        setDirectoryEscapeAbsoluteUrl(null);
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
      </div>

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
        <div className="privacyRunnerInner">
          <div className="grid">
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
                    src={selected?.path ?? "/programs/todo-app/"}
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
        </div>
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
