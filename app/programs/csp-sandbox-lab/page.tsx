"use client";

import { useCallback, useState } from "react";
import styles from "./assets/csp-sandbox-lab.module.css";

export default function CspSandboxLabPage() {
  const [lines, setLines] = useState<string[]>([]);

  const log = useCallback((msg: string) => {
    const t =
      typeof performance !== "undefined"
        ? performance.now().toFixed(0)
        : String(Date.now());
    setLines((prev) => [...prev.slice(-80), "[" + t + "ms] " + msg]);
  }, []);

  const clearLog = useCallback(() => {
    setLines([]);
  }, []);

  const tryFetchSameOrigin = useCallback(async () => {
    try {
      const r = await fetch("/api/health", { method: "GET" });
      log(
        "fetch 同一オリジン /api/health: 応答 status=" +
          r.status +
          "（CSP で connect-src が許可されていれば成功。既定 CSP では失敗しがち）"
      );
    } catch (e) {
      log(
        "fetch 同一オリジン: 失敗 — " +
          (e instanceof Error ? e.message : String(e)) +
          "（connect-src 未指定 → default-src 'none' の影響の可能性）"
      );
    }
  }, [log]);

  const tryFetchExternal = useCallback(async () => {
    try {
      await fetch("https://example.com/", { mode: "no-cors" });
      log("fetch 外部: no-cors でエラーなし（opaque。CSP によりブロックされる環境もあり）");
    } catch (e) {
      log(
        "fetch 外部: 失敗 — " + (e instanceof Error ? e.message : String(e))
      );
    }
  }, [log]);

  const tryXhr = useCallback(() => {
    try {
      const x = new XMLHttpRequest();
      x.open("GET", "/api/health");
      x.onload = () =>
        log("XHR /api/health: onload status=" + x.status);
      x.onerror = () => log("XHR /api/health: onerror（CSP 等でブロックの可能性）");
      x.send();
    } catch (e) {
      log("XHR 生成/送信: " + (e instanceof Error ? e.message : String(e)));
    }
  }, [log]);

  const tryWebSocket = useCallback(() => {
    try {
      const ws = new WebSocket("wss://echo.websocket.org/");
      ws.onopen = () => {
        log("WebSocket: onopen（接続できた）");
        ws.close();
      };
      ws.onerror = () => {
        log("WebSocket: onerror（CSP connect-src 等でブロックされている可能性大）");
      };
      window.setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.close();
          log("WebSocket: 接続タイムアウト（CONNECTING のまま）");
        }
      }, 2500);
    } catch (e) {
      log(
        "WebSocket 生成: " + (e instanceof Error ? e.message : String(e))
      );
    }
  }, [log]);

  const tryConfirm = useCallback(() => {
    const r = window.confirm(
      "このダイアログは sandbox では通常表示されません"
    );
    log(
      "window.confirm 戻り値: " +
        String(r) +
        "（allow-modals なしの iframe ではダイアログが出ず false になりやすい）"
    );
  }, [log]);

  const tryAlert = useCallback(() => {
    window.alert("sandbox でモーダル禁止なら表示されない可能性があります");
    log("window.alert 呼び出し直後（ダイアログは見えない場合があります）");
  }, [log]);

  const tryWindowOpen = useCallback(() => {
    const w = window.open("about:blank", "_blank", "noopener,noreferrer");
    log(
      "window.open: 戻り値は " +
        (w == null ? "null（ブロックまたはポップアップ抑止）" : "非 null") +
        "（allow-popups なしの sandbox では null になりやすい）"
    );
    if (w) w.close();
  }, [log]);

  const tryNestedIframe = useCallback(() => {
    try {
      const el = document.createElement("iframe");
      el.src = "/programs/todo-app/";
      el.title = "nested";
      el.style.width = "1px";
      el.style.height = "1px";
      el.style.opacity = "0";
      el.onload = () =>
        log("子内 iframe: load イベント（frame-src 次第では中身がブロック）");
      el.onerror = () => log("子内 iframe: error");
      document.body.appendChild(el);
      log("子内 iframe を body に追加（CSP frame-src 'none' なら読み込み失敗しがち）");
      window.setTimeout(() => {
        el.remove();
        log("子内 iframe を削除しました");
      }, 2000);
    } catch (e) {
      log("子内 iframe: " + (e instanceof Error ? e.message : String(e)));
    }
  }, [log]);

  const tryWorker = useCallback(() => {
    try {
      const code = "postMessage('ok');";
      const blob = new Blob([code], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      const w = new Worker(url);
      w.onmessage = () => {
        log("Worker: メッセージ受信（worker-src 許可時）");
        w.terminate();
        URL.revokeObjectURL(url);
      };
      w.onerror = (err) => {
        log(
          "Worker: onerror — " +
            (err.message || "worker-src 'none' 等でブロックの可能性")
        );
        URL.revokeObjectURL(url);
      };
      log("Worker を生成（失敗時は CSP worker-src の可能性）");
    } catch (e) {
      log(
        "Worker 生成例外: " + (e instanceof Error ? e.message : String(e))
      );
    }
  }, [log]);

  const tryFormSubmit = useCallback(() => {
    const f = document.createElement("form");
    f.method = "get";
    f.action = "/";
    const btn = document.createElement("button");
    btn.type = "submit";
    btn.textContent = "送信";
    f.appendChild(btn);
    document.body.appendChild(f);
    log(
      "form GET / を生成（sandbox allow-forms なしでは送信が抑止される場合あり。実際に送信するとページ遷移するのでボタンは自動では押しません）"
    );
    f.remove();
  }, [log]);

  /** `HTMLFormElement.prototype.submit()` で送信（iframe 内の同一 URL へ GET。ブロックされなければ子ページが再読込） */
  const tryFormSubmitAuto = useCallback(() => {
    try {
      const f = document.createElement("form");
      f.method = "get";
      const u = new URL(window.location.href);
      u.searchParams.set("_csp_lab_form_auto", String(Date.now()));
      f.action = u.pathname + u.search;
      document.body.appendChild(f);
      log(
        "form GET を programmatic submit（action=このページ + クエリ）。sandbox に allow-forms が無いとブロックされ、ナビしない場合があります。"
      );
      f.submit();
    } catch (e) {
      log(
        "form 自動送信: 例外 — " +
          (e instanceof Error ? e.message : String(e))
      );
    }
  }, [log]);

  const tryExternalImg = useCallback(() => {
    const img = document.createElement("img");
    img.alt = "";
    img.onload = () =>
      log("外部画像: onload（img-src に https が含まれると成功）");
    img.onerror = () =>
      log("外部画像: onerror（img-src が 'self' data: のみなら失敗しがち）");
    img.src =
      "https://www.w3.org/Design/1994/Icons/WWW/w3c_home_unity-96.png";
    document.body.appendChild(img);
    window.setTimeout(() => {
      img.remove();
    }, 4000);
  }, [log]);

  const tryExternalStylesheet = useCallback(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/normalize.css@8.0.1/normalize.css";
    link.onload = () => log("外部 CSS: onload");
    link.onerror = () =>
      log("外部 CSS: onerror（style-src が self のみならブロック）");
    document.head.appendChild(link);
    window.setTimeout(() => {
      link.remove();
    }, 3000);
  }, [log]);

  const trySendBeacon = useCallback(() => {
    const ok = navigator.sendBeacon(
      "/api/health",
      new Blob(["x"], { type: "text/plain" })
    );
    log(
      "sendBeacon /api/health: 戻り値 " +
        String(ok) +
        "（CSP connect-src により失敗扱いになることも）"
    );
  }, [log]);

  const tryObjectTag = useCallback(() => {
    try {
      const o = document.createElement("object");
      o.data = "/favicon.ico";
      o.type = "image/x-icon";
      o.setAttribute("width", "1");
      o.setAttribute("height", "1");
      o.onload = () => log("object: load");
      o.onerror = () =>
        log("object: error（object-src 'none' ならブロック）");
      document.body.appendChild(o);
      window.setTimeout(() => o.remove(), 3000);
      log("object 要素を追加");
    } catch (e) {
      log("object: " + (e instanceof Error ? e.message : String(e)));
    }
  }, [log]);

  return (
    <div className={styles.app}>
      <h1 className={styles.pageTitle}>CSP / sandbox 制限デモ</h1>
      <p className={styles.warn}>
        このページは「子プログラムとして許可されていない操作」を試し、ブラウザ・CSP・iframe
        sandbox によってどうなるかをログに残します。結果はブラウザや設定で異なります。
      </p>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>ネットワーク（connect-src）</h2>
        <p className={styles.desc}>
          既定の子用 CSP ではfetch / XHR / WebSocket 等は多くの環境で失敗します。
        </p>
        <button type="button" className={styles.btn} onClick={tryFetchSameOrigin}>
          fetch 同一オリジン（/api/health）
        </button>
        <button type="button" className={styles.btn} onClick={tryFetchExternal}>
          fetch 外部（example.com）
        </button>
        <button type="button" className={styles.btn} onClick={tryXhr}>
          XMLHttpRequest /api/health
        </button>
        <button type="button" className={styles.btn} onClick={tryWebSocket}>
          WebSocket 接続試行
        </button>
        <button type="button" className={styles.btn} onClick={trySendBeacon}>
          sendBeacon /api/health
        </button>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>iframe sandbox（モーダル・ポップアップ）</h2>
        <button type="button" className={styles.btn} onClick={tryConfirm}>
          window.confirm
        </button>
        <button type="button" className={styles.btn} onClick={tryAlert}>
          window.alert
        </button>
        <button type="button" className={styles.btn} onClick={tryWindowOpen}>
          window.open（about:blank）
        </button>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>埋め込み・Worker・フォーム</h2>
        <p className={styles.desc}>
          CSP の <code className={styles.inlineCode}>frame-src</code> /{" "}
          <code className={styles.inlineCode}>worker-src</code> /{" "}
          <code className={styles.inlineCode}>form-action</code> /{" "}
          <code className={styles.inlineCode}>object-src</code> 周りの例です。赤ボタンは{" "}
          <code className={styles.inlineCode}>form.submit()</code>{" "}
          による自動送信で、許可されていればこの iframe 内だけが再読込されます。
        </p>
        <button type="button" className={styles.btn} onClick={tryNestedIframe}>
          子ページ内に iframe を追加
        </button>
        <button type="button" className={styles.btn} onClick={tryWorker}>
          Web Worker（Blob URL）
        </button>
        <button type="button" className={styles.btn} onClick={tryFormSubmit}>
          form 要素の生成（自動送信なし）
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnDanger}`}
          onClick={tryFormSubmitAuto}
        >
          form GET 自動送信（同一 iframe 内で再読込）
        </button>
        <button type="button" className={styles.btn} onClick={tryObjectTag}>
          &lt;object&gt; で favicon
        </button>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>画像・CSS（img-src / style-src）</h2>
        <p className={styles.desc}>
          既定では外部画像やスタイルシートは拒否されやすいです。
        </p>
        <button type="button" className={styles.btn} onClick={tryExternalImg}>
          外部 https 画像を DOM に追加
        </button>
        <button type="button" className={styles.btn} onClick={tryExternalStylesheet}>
          外部 CSS link を head に追加
        </button>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>ログ</h2>
        <button type="button" className={styles.btn} onClick={clearLog}>
          ログをクリア
        </button>
        <div className={styles.log} aria-live="polite">
          {lines.length === 0 ? (
            <p className={styles.logLine}>上のボタンを押すとここに結果が出ます。</p>
          ) : (
            lines.map((line, i) => (
              <p key={i} className={styles.logLine}>
                {line}
              </p>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
