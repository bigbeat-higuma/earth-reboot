// api/donate.js — Stripeの決済セッションを作成する
// 「再起動を○秒遅らせる」金額を受け取り、Stripe Checkoutページへリダイレクト

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(500).json({ error: "Stripe not configured" });

  const { amount } = req.body; // 円単位（例: 500）
  if (!amount || amount < 100 || amount > 100000) {
    return res.status(400).json({ error: "金額は100円〜100,000円の範囲で指定してください" });
  }

  // 寄付額に応じて「延命秒数」を計算
  // 100円 = 86400秒（1日）延びるイメージ
  const delaySeconds = Math.floor((amount / 100) * 21600); // 100円=6時間

  try {
    const origin = req.headers.origin || `https://${req.headers.host}`;

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        "payment_method_types[]": "card",
        "line_items[0][price_data][currency]": "jpy",
        "line_items[0][price_data][product_data][name]": "地球再起動を遅らせる寄付",
        "line_items[0][price_data][product_data][description]": `この寄付により地球の再起動が${formatDelay(delaySeconds)}延長されます`,
        "line_items[0][price_data][unit_amount]": String(amount),
        "line_items[0][quantity]": "1",
        "mode": "payment",
        "success_url": `${origin}/?donated=1&amount=${amount}&delay=${delaySeconds}`,
        "cancel_url": `${origin}/?donated=0`,
        "metadata[amount_jpy]": String(amount),
        "metadata[delay_seconds]": String(delaySeconds),
        "submit_type": "donate",
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      console.error("Stripe error:", err);
      return res.status(502).json({ error: "Stripe API error", detail: err.error?.message });
    }

    const session = await response.json();
    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error("Donate handler error:", err);
    return res.status(500).json({ error: err.message });
  }
}

function formatDelay(seconds) {
  if (seconds >= 86400 * 365) return `${Math.floor(seconds / 86400 / 365)}年以上`;
  if (seconds >= 86400 * 30)  return `${Math.floor(seconds / 86400 / 30)}ヶ月`;
  if (seconds >= 86400)       return `${Math.floor(seconds / 86400)}日`;
  return `${Math.floor(seconds / 3600)}時間`;
}
