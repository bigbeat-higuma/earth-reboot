import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const subscription = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Invalid subscription' });
    }

    // エンドポイントをキーにして購読情報を保存
    const key = `push:${Buffer.from(subscription.endpoint).toString('base64').slice(0, 50)}`;
    await redis.set(key, JSON.stringify(subscription), { ex: 60 * 60 * 24 * 365 }); // 1年

    // 購読者リストに追加
    await redis.sadd('push:subscribers', key);

    return res.status(201).json({ message: 'Subscribed successfully' });
  } catch (error) {
    console.error('Subscribe error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
