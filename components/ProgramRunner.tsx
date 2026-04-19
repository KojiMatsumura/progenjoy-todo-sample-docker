"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

export type ChildProgram = {
  id: string;
  label: string;
  path: string;
  iframeTitle: string;
};

const FALLBACK_CHILD_PROGRAMS: ChildProgram[] = [
  {
    id: "default",
    label: "ローカルデモ（app/programs/_sites/default）",
    path: "/programs/default/",
    iframeTitle: "ローカルデモプログラム",
  },
  {
    id: "sample-game",
    label: "sample-game（/programs/sample-game/）",
    path: "/programs/sample-game/",
    iframeTitle: "sample-game",
  },
  {
    id: "todo-app",
    label: "TODO（/programs/todo-app/）",
    path: "/programs/todo-app/",
    iframeTitle: "TODO リスト",
  },
];

const childReplyTarget = "*";
const maxEntries = 200;

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

  const [programs, setPrograms] = useState<ChildProgram[] | null>(null);
  const [selected, setSelected] = useState<ChildProgram | null>(null);
  const [expanded, setExpanded] = useState(false);

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
          pre.textContent = JSON.stringify(data);
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

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const cw = iframeRef.current?.contentWindow;
      if (ev.source !== cw) return;
      appendLog("in", "postMessage received", ev.data);

      if (isApi042(ev.data)) {
        if (bridgeBusyRef.current) return;
        bridgeBusyRef.current = true;
        void (async () => {
          try {
            const res = await fetch("/api/runner-data", {
              credentials: "same-origin",
            });
            const body = await res.json().catch(() => ({}));
            appendLog("out", "api_id:1 → data.json 読込", body);
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
        if (bridgeBusyRef.current) return;
        bridgeBusyRef.current = true;
        void (async () => {
          try {
            const data = ev.data as { content: Record<string, unknown> };
            const res = await fetch("/api/runner-data", {
              method: "PUT",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content: data.content }),
            });
            const body = await res.json().catch(() => ({}));
            appendLog("out", "api_id:2 → data.json 保存", body);
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
        <label htmlFor="program-select">表示する子プログラム</label>
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

      <div className="grid">
        <div className="runnerCard">
          <div
            className={
              "viewport" + (expanded ? " viewportExpanded" : "")
            }
          >
            <div className="viewportInner">
              <iframe
                ref={iframeRef}
                src={selected?.path ?? "/programs/default/"}
                title={selected?.iframeTitle ?? "program"}
                sandbox="allow-scripts"
              />
            </div>
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
