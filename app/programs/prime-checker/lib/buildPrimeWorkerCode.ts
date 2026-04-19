/**
 * 親ワーカーで実行されるコード文字列（数値はリテラル埋め込みのみ＝インジェクション対策）
 */
export function buildPrimeWorkerCode(n: number): string {
  return (
    "var n = " +
    n +
    ";\n" +
    "if (typeof n !== 'number' || !isFinite(n) || n !== Math.floor(n) || n < 0) {\n" +
    "  return { ok: false, message: '内部エラー: 整数として扱えません' };\n" +
    "}\n" +
    "if (n < 2) {\n" +
    "  return { ok: true, prime: false, n: n, reason: '2 未満は素数ではありません' };\n" +
    "}\n" +
    "if (n === 2) {\n" +
    "  return { ok: true, prime: true, n: n };\n" +
    "}\n" +
    "if (n % 2 === 0) {\n" +
    "  return { ok: true, prime: false, n: n, reason: '偶数で 2 以外' };\n" +
    "}\n" +
    "var lim = Math.floor(Math.sqrt(n));\n" +
    "var i;\n" +
    "for (i = 3; i <= lim; i += 2) {\n" +
    "  if (n % i === 0) {\n" +
    "    return { ok: true, prime: false, n: n, factor: i };\n" +
    "  }\n" +
    "}\n" +
    "return { ok: true, prime: true, n: n };"
  );
}
