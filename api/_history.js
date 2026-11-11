// api/_history.js — 日次スナップショットの記録と読み出し
//
// 「毎日動く時計」が売りなのに、過去の値をどこにも保存していなかった（2026-11-11 まで）。
// そのため「動いている」ことを見せる手段が無く、8〜10月の値は失われた。
// 日次Cron（notify, 18:00 JST）から1日1件を Redis のハッシュに積む。
//
// ファイル名を "_" で始めているのは Vercel の Serverless Function として数えさせないため
// （Hobbyプランの12本上限が満杯）。読み出しは /api/daily?history=1 に相乗りしている。

export const HISTORY_KEY = "history:daily"; // field = YYYY-MM-DD(JST), value = スナップショット
export const AXES = ["geopolitical", "environmental", "economic", "social", "ai"];

/** JSTの日付文字列（Vercelの実行環境はUTCなので明示的に+9時間する） */
export function jstDateString(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function clampInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
}

/**
 * 解析結果とニュースオーバーレイから、その日の記録を組み立てる。
 * 記録してはいけない場合は null を返す:
 *   - 残り年数が数値でない
 *   - 解析がフォールバック（API障害時に古いキャッシュや固定値を返している状態）
 * 障害中に古い値を毎日積むと、グラフに「横ばい」という嘘の線ができる。
 * 欠損のままにしておけば線が途切れ、鮮度監視（_health.js）が異常として拾う。
 */
export function buildSnapshot(analysis, overlay, now = new Date()) {
  if (!analysis || analysis.fallback) return null;
  const years = parseFloat(analysis.reboot_years_from_now);
  if (!Number.isFinite(years)) return null;

  const threats = {};
  for (const axis of AXES) {
    const v = clampInt(analysis.threats && analysis.threats[axis]);
    if (v !== null) threats[axis] = v;
  }

  const headlines = {};
  const sources = (overlay && overlay.sources) || {};
  for (const axis of AXES) {
    if (sources[axis] && sources[axis].title) headlines[axis] = String(sources[axis].title).slice(0, 160);
  }

  return {
    date: jstDateString(now),
    years: Math.round(years * 10) / 10,
    threats,
    factors: Array.isArray(analysis.key_factors) ? analysis.key_factors.slice(0, 3).map((f) => String(f).slice(0, 40)) : [],
    headlines,
    analyzedAt: analysis.analyzed_at || null,
    recordedAt: now.toISOString(),
  };
}

/** 同じ日に複数回呼ばれても、その日の1件を上書きするだけ（冪等） */
export async function recordSnapshot(redis, snapshot) {
  if (!snapshot || !snapshot.date) return { recorded: false, reason: "no snapshot" };
  await redis.hset(HISTORY_KEY, { [snapshot.date]: JSON.stringify(snapshot) });
  return { recorded: true, date: snapshot.date, years: snapshot.years };
}

/** 日付昇順の配列で返す。days を指定すると直近その日数ぶんに絞る */
export async function readHistory(redis, days = 0) {
  const raw = (await redis.hgetall(HISTORY_KEY)) || {};
  const rows = [];
  for (const [date, value] of Object.entries(raw)) {
    try {
      const row = typeof value === "string" ? JSON.parse(value) : value;
      if (row && Number.isFinite(Number(row.years))) rows.push({ ...row, date });
    } catch (e) {
      // 壊れた1件のために全体を落とさない
    }
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  if (days > 0) {
    const cutoff = jstDateString(new Date(Date.now() - days * 86400000));
    return rows.filter((r) => r.date >= cutoff);
  }
  return rows;
}
