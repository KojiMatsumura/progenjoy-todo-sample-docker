/**
 * MainThreadWatchdog（dedicated worker）と ProgramRunner（子 iframe プローブ）の接続。
 * 子のメインが詰まっているときは親が ping に pong しないよう、ここで判定する。
 */
let pingAllowedGetter: (() => boolean) | null = null;

export function registerWatchdogPingAllowedGetter(
  fn: () => boolean
): () => void {
  pingAllowedGetter = fn;
  return () => {
    pingAllowedGetter = null;
  };
}

export function isWatchdogPingAllowed(): boolean {
  if (!pingAllowedGetter) return true;
  return pingAllowedGetter();
}
