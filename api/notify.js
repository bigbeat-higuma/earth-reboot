import { Redis } from '@upstash/redis';
import webpush from 'web-push';

const redis = Redis.fromEnv();

webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 購読者リストを取得
    const keys = await redis.smembers('push:subscribers');
    if (!keys || keys.length === 0) {
      return res.status(200).json({ message: 'No subscribers', sent: 0 });
    }

    // 再起動日までの残り日数を計算
    const rebootDate = new Date('2038-10-05T02:10:00');
    const now = new Date();
    const diffDays = Math.floor((rebootDate - now) / (1000 * 60 * 60 * 24));

    const payload = JSON.stringify({
      title: '🌍 地球再起動時間',
      body: `地球の再起動まであと ${diffDays} 日。あなたの支援がカウントダウンを遅らせます。`,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      url: 'https://earth-reboot.vercel.app',
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

    // 無効な購読者を削除
    if (toRemove.length > 0) {
      await redis.srem('push:subscribers', ...toRemove);
      for (const key of toRemove) await redis.del(key);
    }

    return res.status(200).json({ message: 'Done', sent, failed });
  } catch (error) {
    console.error('Notify error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
