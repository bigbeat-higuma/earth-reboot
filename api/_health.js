// api/_health.js — 無人運用のための総合ヘルス判定
//
// このサイトは数か月単位で誰も見に来ない前提で動いている。壊れても気づけないのが
// 最大の弱点で、実際に過去、AIモデルの提供終了で解析が2週間止まっていたことがある。
// /api/daily?health=1 がこの判定結果を返し、異常なら HTTP 503 になる。
// GitHub Actions（.github/workflows/health-check.yml）が毎日それを叩き、
// 失敗すると GitHub からメールが届く。
//
// 判定は純粋関数にしてある（scripts/test-history.mjs で検証）。

const HOUR = 3600000;
const DAY = 24 * HOUR;

export const LIMITS = {
  newsStaleHours: 30,      // 日次ニュース取得（06:00 JST）が1回飛んだら異常
  analysisStaleHours: 36,  // 解析は notify Cron が毎日18:00に更新させる
  historyMaxDaysBehind: 1, // 18:00の記録前は「昨日まで」が正常。2日遅れたら異常
  xMaxSilentDays: 6,       // 投稿は月・水・土。同一文面スキップ1回を見込んでも5日以内
  watchStaleHours: 12,     // 速報の見張りは3時間おき。GitHub Actions の遅延と数回の失敗を見込む
};

function round1(n) { return Math.round(n * 10) / 10; }

function daysBetween(dateA, dateB) {
  return Math.round((Date.parse(dateB + "T00:00:00Z") - Date.parse(dateA + "T00:00:00Z")) / DAY);
}

/**
 * @param {object} s
 * @param {object|null} s.overlay        dyn:overlay:latest
 * @param {object|null} s.analysis       analysis_cache_ja
 * @param {string|null} s.historyLatest  履歴の最新日付 (YYYY-MM-DD, JST)
 * @param {string|null} s.xLastPostAt    最後にXへ投稿できた時刻 (ISO)
 * @param {boolean}     s.xEnabled       XのAPIキーが設定されているか
 * @param {string|null} s.watchLastCheckAt 速報の見張りが最後に成功した時刻 (ISO)
 * @param {string}      s.todayJst       今日の日付 (YYYY-MM-DD, JST)
 * @param {number}      s.now            現在時刻 (ms)
 */
export function evaluateHealth(s) {
  const now = s.now;
  const checks = {};

  // 1. 日次ニュース
  const ov = s.overlay;
  if (!ov || typeof ov !== "object") {
    checks.news = { ok: false, reason: "オーバーレイが存在しません（Cron未実行 or Redis空）" };
  } else {
    const age = ov.generatedAt ? (now - Date.parse(ov.generatedAt)) / HOUR : null;
    const patches = Array.isArray(ov.patches) ? ov.patches.length : 0;
    const ok = age !== null && age <= LIMITS.newsStaleHours && patches > 0;
    checks.news = { ok, date: ov.date || null, ageHours: age === null ? null : round1(age), patches };
    if (!ok) checks.news.reason = patches === 0 ? "ニュースが0件です" : "日次ニュース取得が止まっています";
  }

  // 2. AI解析
  const an = s.analysis;
  if (!an || !an.analyzed_at) {
    checks.analysis = { ok: false, reason: "解析キャッシュがありません" };
  } else {
    const age = (now - Date.parse(an.analyzed_at)) / HOUR;
    const ok = age <= LIMITS.analysisStaleHours;
    checks.analysis = { ok, ageHours: round1(age), years: an.reboot_years_from_now };
    if (!ok) checks.analysis.reason = "AI解析が更新されていません（モデル廃止・APIキー・残高を確認）";
  }

  // 3. 履歴の記録
  if (!s.historyLatest) {
    checks.history = { ok: false, reason: "履歴が1件もありません" };
  } else {
    const behind = daysBetween(s.historyLatest, s.todayJst);
    const ok = behind <= LIMITS.historyMaxDaysBehind;
    checks.history = { ok, latest: s.historyLatest, daysBehind: behind };
    if (!ok) checks.history.reason = "日次の記録が止まっています（notify Cron または解析の失敗）";
  }

  // 4. X自動投稿（キー未設定なら対象外）
  if (!s.xEnabled) {
    checks.x = { ok: true, status: "disabled" };
  } else if (!s.xLastPostAt) {
    checks.x = { ok: false, reason: "Xへの投稿記録がありません" };
  } else {
    const silent = (now - Date.parse(s.xLastPostAt)) / DAY;
    const ok = silent <= LIMITS.xMaxSilentDays;
    checks.x = { ok, lastPostAt: s.xLastPostAt, silentDays: round1(silent) };
    if (!ok) checks.x.reason = "Xへの投稿が止まっています（クレジット残高・トークンを確認）";
  }

  // 5. 速報の見張り（_breaking.js）。一度も動いていなければ未設定とみなし、対象外にする。
  // 動き始めたあとで止まった場合だけ異常にする（GitHub の鍵の失効やワークフロー停止を拾う）。
  if (!s.watchLastCheckAt) {
    checks.watch = { ok: true, status: "not started" };
  } else {
    const age = (now - Date.parse(s.watchLastCheckAt)) / HOUR;
    const ok = age <= LIMITS.watchStaleHours;
    checks.watch = { ok, lastCheckAt: s.watchLastCheckAt, ageHours: round1(age) };
    if (!ok) checks.watch.reason = "速報の見張りが止まっています（GitHub Actions の breaking-watch と WATCH_SECRET を確認）";
  }

  const failed = Object.entries(checks).filter(([, c]) => !c.ok).map(([k]) => k);
  return { ok: failed.length === 0, failed, checks, limits: LIMITS, checkedAt: new Date(now).toISOString() };
}
