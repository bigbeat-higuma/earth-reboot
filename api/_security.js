// api/_security.js — 複数のAPIエンドポイントで共有するセキュリティ用ユーティリティ
// - CORS: 書き込み系エンドポイント向けのオリジン許可リスト方式
// - トークン比較: タイミング攻撃に強い定数時間比較
import crypto from "crypto";

// サイトの正式オリジン。開発用に localhost も許可する。
const ALLOWED_ORIGINS = new Set([
  "https://www.earth-re-boot.com",
  "https://earth-re-boot.com",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
]);

/**
 * 書き込み系（POST等）エンドポイント用のCORSヘッダーを設定する。
 * Origin が許可リストに含まれる場合のみ Access-Control-Allow-Origin を反映する。
 * 許可リスト外の場合はヘッダーを付与しない（ブラウザ側でブロックされる）。
 */
export function applyRestrictedCors(req, res, methods = "POST, OPTIONS") {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/**
 * 2つのトークン文字列を定数時間で比較する。
 * 長さが異なる場合や入力が文字列でない場合は false を返す（タイミング情報を漏らさないよう
 * 比較自体は常に固定長バッファで実行する）。
 */
export function timingSafeTokenEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // 長さが違う場合も同程度の処理時間を消費させるためダミー比較を行う
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * クライアントの実IPアドレスを推定する（Vercel/プロキシ環境向け）。
 */
export function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}
