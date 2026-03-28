# 地球再起動時間 — デプロイ手順

## フォルダ構成
```
earth-reboot/
├── api/
│   └── analyze.js      ← バックエンド（APIキーをここで管理）
├── public/
│   └── index.html      ← フロントエンド
├── vercel.json         ← Vercel設定
└── README.md
```

---

## デプロイ手順（所要時間：約15分）

### Step 1 — GitHubにリポジトリを作る
1. https://github.com/new を開く
2. リポジトリ名を「earth-reboot」などにして「Create repository」
3. このフォルダの中身をまるごとアップロード

```bash
# ターミナルが使える場合
git init
git add .
git commit -m "first commit"
git remote add origin https://github.com/あなたのID/earth-reboot.git
git push -u origin main
```

### Step 2 — Vercelにデプロイ
1. https://vercel.com にアクセスしてGitHubアカウントでサインアップ
2. 「Add New Project」→ 先ほどのリポジトリを選択
3. **Framework Preset** は「Other」を選択
4. **Root Directory** は「./」のまま
5. 「Deploy」をクリック → 約1分でデプロイ完了

### Step 3 — APIキーを環境変数に設定（最重要）
1. Vercelのプロジェクトページで「Settings」→「Environment Variables」を開く
2. 以下を追加：
   - **Name**: `ANTHROPIC_API_KEY`
   - **Value**: `sk-ant-xxxxxxxx...`（AnthropicコンソールのAPIキー）
   - **Environment**: Production, Preview, Development すべてチェック
3. 「Save」→「Redeploy」（設定を反映させるために再デプロイが必要）

### Step 4 — 動作確認
- `https://あなたのプロジェクト.vercel.app` にアクセス
- 正常に解析が走ればOK
- `https://あなたのプロジェクト.vercel.app/api/analyze` に直接アクセスするとJSONが見える

### Step 5 — 独自ドメインを設定（任意）
1. お名前.comやムームードメインでドメインを取得（例：earth-reboot.com）
2. Vercelの「Settings」→「Domains」でドメインを追加
3. ドメイン側でDNS設定（VercelがガイドしてくれるのでそのとおりにやればOK）

---

## キャッシュの仕組み

- 最初のアクセス → AIがウェブ検索して解析 → 結果をサーバーに保存
- 6時間以内の2回目以降 → 保存済みの結果をそのまま返す（APIを呼ばない）
- 6時間経過後 → 次のアクセス時に自動で再解析
- 「強制再解析」ボタン → キャッシュを無視してすぐ再解析

これにより1日4〜5回しかAPIを呼び出さないため、コストが大幅に削減されます。

---

## コスト目安（Claude Sonnet 4.6）

| 1日のアクセス | 月のAPI呼び出し | 月額コスト目安 |
|---|---|---|
| 〜1,000人 | 約120回 | 約5〜10円 |
| 〜10,000人 | 約120回 | 約5〜10円（同じ！） |
| バズって100,000人 | 約120回 | 約5〜10円（同じ！） |

※ キャッシュのおかげでアクセス数が増えてもAPIコストは変わりません。

---

## Anthropic APIキーの取得方法

1. https://console.anthropic.com にアクセス
2. サインアップ → クレジットカードを登録
3. 「API Keys」→「Create Key」
4. 表示されたキー（`sk-ant-...`）をコピーしてVercelの環境変数に貼り付ける

**注意**: APIキーは絶対にindex.htmlやGitHubに書かないこと。
