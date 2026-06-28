// api/donate.js — Stripeの決済セッションを作成する
// 運営協力金（サーバー・API利用料等）の金額を受け取り、Stripe Checkoutページへリダイレクト
// 注: 寄付による再起動カウントダウンの延命機能は廃止済み（カウントダウンは実ニュース連動）

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
        "line_items[0][price_data][product_data][name]": "地球再起動時間 — 運営協力金",
        "line_items[0][price_data][product_data][description]": "サーバー運営費・API利用料等の運営協力金としてご活用させていただきます",
        "line_items[0][price_data][unit_amount]": String(amount),
        "line_items[0][quantity]": "1",
        "mode": "payment",
        "success_url": `${origin}/?donated=1&amount=${amount}`,
        "cancel_url": `${origin}/?donated=0`,
        "metadata[amount_jpy]": String(amount),
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
