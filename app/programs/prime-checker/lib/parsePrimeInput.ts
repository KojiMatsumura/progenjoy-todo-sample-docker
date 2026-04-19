export type ParsePrimeInputOk = { n: number };
export type ParsePrimeInputErr = { error: string };

export function parsePrimeInput(raw: string): ParsePrimeInputOk | ParsePrimeInputErr {
  const t = raw.trim();
  if (!t) {
    return { error: "数を入力してください" };
  }
  if (!/^\d+$/.test(t)) {
    return { error: "0 以上の整数（数字のみ）を入力してください" };
  }
  if (t.length > 16) {
    return { error: "桁数が大きすぎます" };
  }
  const n = parseInt(t, 10);
  if (n > Number.MAX_SAFE_INTEGER) {
    return { error: "安全に扱える範囲を超えています" };
  }
  return { n };
}
