# scripts/generate-x-header.ps1
# X(Twitter) のプロフィールヘッダー画像 (1500x500) を生成する。
#
#   powershell -ExecutionPolicy Bypass -File scripts/generate-x-header.ps1
#
# 経緯: 旧ヘッダーは 2026-08-09 に作り直した OGP の元画像と同じもので、
#   - 2026-06-28 に廃止した「YOUR DONATION DELAYS THE REBOOT」が残存
#   - 日本語が豆腐文字（□）
#   - 固定のカウントダウン数値と再起動日 2038/10/05 のハードコード
#   を抱えたままだった。プロフィール訪問者が最初に見る画像なので文言を現行仕様に揃える。
#
# 方針: generate-ogp.ps1 と同じ配色・同じメッセージを使い、静的画像に数値は焼き込まない。
#
# レイアウト上の注意: X はヘッダーの左下にプロフィールアイコンを重ねて表示し、
# さらに表示幅によって左右が切れる。そのため主要な要素はすべて中央寄せにし、
# 左下（およそ x<300, y>380）には文字を置かない。
#
# ⚠️ このファイルは UTF-8 BOM 付きで保存すること（PowerShell 5.1 は BOM なしを
#    ANSI として読むため日本語が壊れて構文エラーになる）。
# ⚠️ ループ変数に $h を使わないこと（大文字小文字を区別せず画像高さの $H を破壊する）。

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$outPath = Join-Path $PSScriptRoot '..\docs\x-header.png'

$W = 1500; $H = 500

# --- 文言（generate-ogp.ps1 と揃える） ---
$titleJa   = '地球再起動時間'
$subEn     = 'E A R T H   R E B O O T   C O U N T D O W N   S Y S T E M'
$messageJa = '毎日の実ニュースが、カウントダウンを動かす。'
$messageEn = "AI READS TODAY'S NEWS  //  THE CLOCK MOVES WITH THE WORLD"
$siteUrl   = 'www.earth-re-boot.com'
$tagTop    = '// EARTH REBOOT COUNTDOWN SYSTEM'

# --- 配色 ---
$cBg     = [System.Drawing.Color]::FromArgb(255,  8,  2,  2)
$cGlow   = [System.Drawing.Color]::FromArgb(255, 74, 10, 10)
$cDim    = [System.Drawing.Color]::FromArgb(255, 122, 24, 24)
$cMid    = [System.Drawing.Color]::FromArgb(255, 190, 40, 40)
$cBright = [System.Drawing.Color]::FromArgb(255, 255, 68, 58)

$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

$g.Clear($cBg)

# 左右対称に淡いグロー（どちら側が切れても印象が変わらないように）
foreach ($cx in @(-160, 1160)) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddEllipse($cx, -180, 500, 860)
  $glow = New-Object System.Drawing.Drawing2D.PathGradientBrush $path
  $glow.CenterColor = $cGlow
  $glow.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 74, 10, 10))
  $g.FillPath($glow, $path)
  $glow.Dispose(); $path.Dispose()
}

# 走査線
$scan = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(16, 255, 60, 60))
for ($y = 0; $y -lt $H; $y += 4) { $g.FillRectangle($scan, 0, $y, $W, 1) }
$scan.Dispose()

# 外枠と四隅のティック
$penFrame = New-Object System.Drawing.Pen $cDim, 1
$g.DrawRectangle($penFrame, 20, 20, ($W - 41), ($H - 41))
$penTick = New-Object System.Drawing.Pen $cMid, 3
$L = 20; $R = $W - 21; $T = 20; $B = $H - 21; $n = 24
$g.DrawLine($penTick, $L, $T, ($L + $n), $T); $g.DrawLine($penTick, $L, $T, $L, ($T + $n))
$g.DrawLine($penTick, $R, $T, ($R - $n), $T); $g.DrawLine($penTick, $R, $T, $R, ($T + $n))
$g.DrawLine($penTick, $L, $B, ($L + $n), $B); $g.DrawLine($penTick, $L, $B, $L, ($B - $n))
$g.DrawLine($penTick, $R, $B, ($R - $n), $B); $g.DrawLine($penTick, $R, $B, $R, ($B - $n))
$penFrame.Dispose(); $penTick.Dispose()

# --- フォント ---
$fMono  = New-Object System.Drawing.Font 'Consolas', 14, ([System.Drawing.FontStyle]::Regular)
$fSub   = New-Object System.Drawing.Font 'Consolas', 16, ([System.Drawing.FontStyle]::Bold)
$fMsgEn = New-Object System.Drawing.Font 'Consolas', 15, ([System.Drawing.FontStyle]::Regular)
$fUrl   = New-Object System.Drawing.Font 'Consolas', 22, ([System.Drawing.FontStyle]::Bold)
$fTitle = New-Object System.Drawing.Font 'Yu Gothic UI', 58, ([System.Drawing.FontStyle]::Bold)
$fMsg   = New-Object System.Drawing.Font 'Yu Gothic UI', 30, ([System.Drawing.FontStyle]::Bold)

$bDim    = New-Object System.Drawing.SolidBrush $cDim
$bMid    = New-Object System.Drawing.SolidBrush $cMid
$bBright = New-Object System.Drawing.SolidBrush $cBright

# 中央寄せで描画するヘルパー
function Draw-Centered($text, $font, $brush, $y) {
  $sz = $g.MeasureString($text, $font)
  $g.DrawString($text, $font, $brush, (($W - $sz.Width) / 2), $y)
}

# 上部バー（左右端は切れる可能性があるため補助情報のみ）
$g.DrawString($tagTop, $fMono, $bDim, 44, 40)
$szUrl = $g.MeasureString($siteUrl, $fMono)
$g.DrawString($siteUrl, $fMono, $bDim, ($W - 44 - $szUrl.Width), 40)

# 中央ブロック
Draw-Centered $titleJa   $fTitle $bBright 96
Draw-Centered $subEn     $fSub   $bDim    196

$penDiv = New-Object System.Drawing.Pen $cDim, 1
$g.DrawLine($penDiv, 420, 246, ($W - 420), 246)
$penDiv.Dispose()

Draw-Centered $messageJa $fMsg   $bBright 272
Draw-Centered $messageEn $fMsgEn $bMid    334
Draw-Centered $siteUrl   $fUrl   $bBright 392

foreach ($o in @($fMono,$fSub,$fMsgEn,$fUrl,$fTitle,$fMsg,$bDim,$bMid,$bBright)) { $o.Dispose() }
$g.Dispose()

$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

$resolved = (Resolve-Path $outPath).Path
Write-Output "生成: $resolved ($([int]((Get-Item $resolved).Length/1KB)) KB / ${W}x${H})"
