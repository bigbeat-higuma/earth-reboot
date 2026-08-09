# scripts/generate-ogp.ps1
# OGP画像 (public/ogp.png, 1200x630) を生成する。
#
#   powershell -ExecutionPolicy Bypass -File scripts/generate-ogp.ps1
#
# 経緯: 旧OGPは手作業でアップロードされた画像で、生成元が無かったため内容が古びていた。
#   - 2026-06-28 に廃止した「YOUR DONATION DELAYS THE REBOOT」が残存
#   - 日本語が豆腐文字（□）— 生成時に日本語フォントが無かったとみられる
#   - 再起動日 2038/10/05 のハードコード、および固定のカウントダウン数値
# OGPは X・note・LINE 等あらゆる共有で表示されるため、文言は現行仕様と一致させること。
#
# 方針: 静的画像に「その時点の数値」を焼き込まない。数値は必ず古くなる。
#       代わりに「何が時計を動かすのか」というコンセプトを載せる。

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$outPath = Join-Path $PSScriptRoot '..\public\ogp.png'

$W = 1200; $H = 630

# --- 文言（現行仕様と一致させる。寄付とカウントダウンは無関係） ---
$titleJa    = '地球再起動時間'
$subEn      = 'E A R T H   R E B O O T   C O U N T D O W N   S Y S T E M'
$messageJa  = '毎日の実ニュースが、カウントダウンを動かす。'
$messageEn  = "AI READS TODAY'S NEWS  //  THE CLOCK MOVES WITH THE WORLD"
$siteUrl    = 'www.earth-re-boot.com'
$tagTop     = '// EARTH REBOOT COUNTDOWN SYSTEM'
$tagBottom  = '// NEWS-DRIVEN DOOMSDAY CLOCK'

# --- 配色 ---
$cBg      = [System.Drawing.Color]::FromArgb(255,  8,  2,  2)
$cGlow    = [System.Drawing.Color]::FromArgb(255, 74, 10, 10)
$cDim     = [System.Drawing.Color]::FromArgb(255, 122, 24, 24)
$cMid     = [System.Drawing.Color]::FromArgb(255, 190, 40, 40)
$cBright  = [System.Drawing.Color]::FromArgb(255, 255, 68, 58)

$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

# 背景
$g.Clear($cBg)

# 右側の赤いグロー（放射グラデーション）
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddEllipse(700, -160, 760, 760)
$glow = New-Object System.Drawing.Drawing2D.PathGradientBrush $path
$glow.CenterColor = $cGlow
$glow.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 74, 10, 10))
$g.FillPath($glow, $path)
$glow.Dispose(); $path.Dispose()

# 走査線（HUDらしさ。ごく薄く）
$scan = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(16, 255, 60, 60))
for ($y = 0; $y -lt $H; $y += 4) { $g.FillRectangle($scan, 0, $y, $W, 1) }
$scan.Dispose()

# 外枠と四隅のティック
$penFrame = New-Object System.Drawing.Pen $cDim, 1
$g.DrawRectangle($penFrame, 24, 24, $W - 49, $H - 49)
$penTick = New-Object System.Drawing.Pen $cMid, 3
$L = 24; $R = $W - 25; $T = 24; $B = $H - 25; $n = 26
# 左上・右上・左下・右下
$g.DrawLine($penTick, $L, $T, ($L + $n), $T); $g.DrawLine($penTick, $L, $T, $L, ($T + $n))
$g.DrawLine($penTick, $R, $T, ($R - $n), $T); $g.DrawLine($penTick, $R, $T, $R, ($T + $n))
$g.DrawLine($penTick, $L, $B, ($L + $n), $B); $g.DrawLine($penTick, $L, $B, $L, ($B - $n))
$g.DrawLine($penTick, $R, $B, ($R - $n), $B); $g.DrawLine($penTick, $R, $B, $R, ($B - $n))
$penFrame.Dispose(); $penTick.Dispose()

# --- フォント ---
$fMono   = New-Object System.Drawing.Font 'Consolas', 15, ([System.Drawing.FontStyle]::Regular)
$fMonoSm = New-Object System.Drawing.Font 'Consolas', 17, ([System.Drawing.FontStyle]::Regular)
$fSub    = New-Object System.Drawing.Font 'Consolas', 19, ([System.Drawing.FontStyle]::Bold)
$fUrl    = New-Object System.Drawing.Font 'Consolas', 33, ([System.Drawing.FontStyle]::Bold)
$fTitle  = New-Object System.Drawing.Font 'Yu Gothic UI', 66, ([System.Drawing.FontStyle]::Bold)
$fMsg    = New-Object System.Drawing.Font 'Yu Gothic UI', 37, ([System.Drawing.FontStyle]::Bold)

$bDim    = New-Object System.Drawing.SolidBrush $cDim
$bMid    = New-Object System.Drawing.SolidBrush $cMid
$bBright = New-Object System.Drawing.SolidBrush $cBright

# 上部バー
$g.DrawString($tagTop, $fMono, $bDim, 48, 46)
$sz = $g.MeasureString($siteUrl, $fMono)
$g.DrawString($siteUrl, $fMono, $bDim, ($W - 48 - $sz.Width), 46)

# タイトル
$g.DrawString($titleJa, $fTitle, $bBright, 44, 116)
$g.DrawString($subEn, $fSub, $bDim, 52, 224)

# 区切り線
$penDiv = New-Object System.Drawing.Pen $cDim, 1
$g.DrawLine($penDiv, 48, 286, $W - 48, 286)
$penDiv.Dispose()

# 主メッセージ（旧「YOUR DONATION DELAYS THE REBOOT」を置き換える中核の文言）
$g.DrawString($messageJa, $fMsg, $bBright, 44, 330)
$g.DrawString($messageEn, $fMonoSm, $bMid, 48, 402)

# 装飾の目盛り（具体的な数値は載せない。静的画像の数値は必ず古くなるため）
$penMark = New-Object System.Drawing.Pen $cDim, 2
for ($i = 0; $i -lt 24; $i++) {
  $x = 48 + $i * 20
  # 変数名を $h にしないこと。PowerShell は大文字小文字を区別せず、画像高さの $H を壊す
  $tickH = $(if ($i % 4 -eq 0) { 16 } else { 8 })
  $g.DrawLine($penMark, $x, 470, $x, 470 - $tickH)
}
$penMark.Dispose()

# 下部
$g.DrawString($siteUrl, $fUrl, $bBright, 44, 520)
$sz2 = $g.MeasureString($tagBottom, $fMono)
$g.DrawString($tagBottom, $fMono, $bDim, ($W - 48 - $sz2.Width), 556)

foreach ($o in @($fMono,$fMonoSm,$fSub,$fUrl,$fTitle,$fMsg,$bDim,$bMid,$bBright)) { $o.Dispose() }
$g.Dispose()

$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

$resolved = (Resolve-Path $outPath).Path
Write-Output "生成: $resolved ($([int]((Get-Item $resolved).Length/1KB)) KB / ${W}x${H})"
