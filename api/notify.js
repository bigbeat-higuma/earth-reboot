// api/notify.js — 購読者へプッシュ通知を送る（日次Cron: 09:00 UTC = 18:00 JST）
//
// 認証: daily-build.js と同じく CRON_SECRET による Bearer 認証。
// これが無いと誰でも POST で全購読者へ通知を配信できてしまうため必須。
//
// カウントダウンの出典（2026-08-08 修正）:
// 以前は再起動日を 2038-10-05 に固定していたが、メインサイトのカウントダウンは
// AI解析（/api/analyze）の reboot_years_from_now を analyzed_at 起点で換算した値であり、
// 通知の日数がサイト表示と食い違っていた。ここでは analyze のキャッシュを直接読み、
// public/index.html と同じ式で残り日数を算出する（Claude API は呼ばないので費用ゼロ）。
// 値が取れない場合は「誤った日数を送るくらいなら送らない」方針でスキップする。

import { Redis } from '@upstash/redis';
import webpush from 'web-push';
import { timingSafeTokenEqual } from './_security.js';
import { postDailyUpdate } from './_x-post.js';

// Redis 接続（2026-08-08 修正）:
// 以前は Redis.fromEnv() を使っていたが、これは UPSTASH_REDIS_REST_URL / _TOKEN を参照する。
// 本番に設定されているのは KV_REST_API_URL / _TOKEN のみで UPSTASH_* は存在しないため、
// subscribe / notify は Redis 呼び出しのたびに失敗し、プッシュ通知は機能していなかった。
// 他のエンドポイント（analyze / daily / save 等）と同じく明示的に KV_REST_API_* を渡す。
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const ANALYSIS_CACHE_KEY = 'analysis_cache_ja'; // analyze.js が書き込むキー
const SITE_URL = 'https://www.earth-re-boot.com';

webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// AI解析の結果を取得する。
//
// ⚠️ Redis の analysis_cache_ja を直接読んではいけない（2026-08-12 の不具合）。
// analyze.js はキャッシュが6時間より古いときに再生成するが、その再生成は
// 「誰かが /api/analyze を呼んだとき」にしか起きない。サイトの訪問が少ないと
// キャッシュが何日も凍ったままになり、投稿日をまたいでも同じ内容を投稿してしまう。
// 実際 8/10 と 8/12 の自動投稿が「残り約11.5年」の同一文面になった。
//
// そのため /api/analyze を経由して取得する。期限切れなら向こうで再生成される。
// 取得できなかった場合のみ、日数だけでも出せるよう Redis のキャッシュへフォールバックする。
async function fetchAnalysis() {
  try {
    const res = await fetch(`${SITE_URL}/api/analyze`, {
      headers: { 'User-Agent': 'earth-reboot-cron' },
    });
    if (res.ok) {
      const json = await res.json();
      if (json && typeof json.reboot_years_from_now !== 'undefined') return json;
    }
    console.error(`Notify: analyze fetch returned ${res.status}`);
  } catch (err) {
    console.error('Notify: analyze fetch failed:', err);
  }
  try {
    return await redis.get(ANALYSIS_CACHE_KEY);
  } catch (err) {
    console.error('Notify: analysis cache read failed:', err);
    return null;
  }
}

// メインサイト（public/index.html）と同じ計算で再起動までの残り日数を求める
function daysUntilReboot(analysis) {
  if (!analysis) return null;

  const years = parseFloat(analysis.reboot_years_from_now);
  if (!Number.isFinite(years)) return null;

  const analyzedAt = analysis.analyzed_at ? new Date(analysis.analyzed_at) : new Date();
  if (Number.isNaN(analyzedAt.getTime())) return null;

  const target = analyzedAt.getTime() + years * 365.25 * 24 * 3600 * 1000;
  const days = Math.floor((target - Date.now()) / (1000 * 60 * 60 * 24));
  return days > 0 ? days : null;
}

// プッシュ通知の送信。購読者が居ない場合も含め、例外を投げずに結果を返す。
async function sendPushNotifications(diffDays) {
  const keys = await redis.smembers('push:subscribers');
  if (!keys || keys.length === 0) return { sent: 0, failed: 0, reason: 'no subscribers' };
  if (diffDays === null) {
    // サイト表示と食い違う日数を送るより、送らない方が害が少ない
    console.error('Notify: push skipped — 再起動までの残り日数を算出できませんでした');
    return { sent: 0, failed: 0, reason: 'countdown unavailable' };
  }

  const payload = JSON.stringify({
    title: '🌍 地球再起動時間',
    // カウントダウンは実ニュース連動。寄付による延命は 2026-06-28 に廃止済みのため訴求しない
    body: `地球の再起動まであと ${diffDays} 日。今日の世界のニュースが、この時間を動かしています。`,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    url: SITE_URL,
  });

  let sent = 0;
  let failed = 0;
  const toRemove = [];

  for (const key of keys) {
    try {
      const subStr = await redis.get(key);
      if (!subStr) { toRemove.push(key); continue; }
      const subscription = typeof subStr === 'string' ? JSON.parse(subStr) : subStr;
      await webpush.sendNotification(subscription, payload);
      sent++;
    } catch (err) {
      // 410 Gone = 購読解除済み → 削除
      if (err.statusCode === 410 || err.statusCode === 404) {
        toRemove.push(key);
      }
      failed++;
    }
  }

  if (toRemove.length > 0) {
    await redis.srem('push:subscribers', ...toRemove);
    for (const key of toRemove) await redis.del(key);
  }

  return { sent, failed };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Vercel Cron の認証。User-Agent は詐称できるため認証の根拠に使わない。
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers['authorization'] || '';
    if (!timingSafeTokenEqual(auth, `Bearer ${cronSecret}`)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const analysis = await fetchAnalysis();
    const diffDays = daysUntilReboot(analysis);

    const push = await sendPushNotifications(diffDays);

    // X への定期投稿。購読者ゼロでもここに到達させるため、プッシュ通知とは独立して実行する。
    // 投稿しない条件（キー未設定・対象曜日外・投稿済み等）はすべてスキップ扱いで返る。
    let x;
    try {
      x = await postDailyUpdate(redis, analysis);
    } catch (err) {
      // X側の失敗でCron全体を落とさない
      console.error('X post error:', err);
      x = { posted: false, reason: 'exception' };
    }

    return res.status(200).json({ message: 'Done', days: diffDays, push, x });
  } catch (error) {
    console.error('Notify error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
