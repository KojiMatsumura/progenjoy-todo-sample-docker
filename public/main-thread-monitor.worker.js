/* メインスレッド死活監視: poll 間隔で経過を見る。1 秒ごとに ping、最後の pong から 3 秒以上なら停滞。
 * 監視対象は「この Worker を抱えるウィンドウ」のメインスレッドのみ。iframe 内の無限ループは親の監視には現れない。 */
const POLL_MS = 250;
const PING_EVERY_MS = 1000;
const STALL_MS = 3000;

let lastPong = Date.now();
let paused = false;
let stalledSent = false;
let tickCount = 0;

self.onmessage = (e) => {
  const d = e.data;
  if (d?.type === "pause") {
    paused = true;
    return;
  }
  if (d?.type === "resume") {
    paused = false;
    lastPong = Date.now();
    stalledSent = false;
    return;
  }
  if (d?.type === "pong") {
    lastPong = Date.now();
    stalledSent = false;
  }
};

const ticksPerPing = PING_EVERY_MS / POLL_MS;

setInterval(() => {
  if (paused) return;
  tickCount += 1;

  const elapsed = Date.now() - lastPong;
  if (elapsed >= STALL_MS && !stalledSent) {
    stalledSent = true;
    self.postMessage({ type: "stalled" });
  }

  if (tickCount % ticksPerPing === 0) {
    self.postMessage({ type: "ping" });
  }
}, POLL_MS);
