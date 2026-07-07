// vercel dev ローカル開発用: .env.local / .env.development.local を読み込む。
// Vercel ダッシュボードで Development に登録できない変数のフォールバック。
import fs from "fs";
import path from "path";

let loaded = false;

export function loadLocalEnv() {
  if (loaded) return;
  loaded = true;

  const root = process.cwd();
  for (const file of [".env.development.local", ".env.local"]) {
    const envPath = path.join(root, file);
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      // ローカルファイルを Vercel 注入値より優先（Development 未登録変数の上書き）
      process.env[key] = val;
    }
  }
}
