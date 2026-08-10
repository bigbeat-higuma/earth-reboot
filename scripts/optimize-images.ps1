# scripts/optimize-images.ps1
# public/images/*.jpg を Web 配信向けに再圧縮する。
#
#   powershell -ExecutionPolicy Bypass -File scripts/optimize-images.ps1 -DryRun
#   powershell -ExecutionPolicy Bypass -File scripts/optimize-images.ps1
#
# 経緯: 生成AIから保存した背景画像が 1枚あたり 1.5〜2.7MB あり、画像18枚で 56MB あった。
# ゲームはシーン遷移のたびに背景を読み込むため、モバイル回線では体感が悪い。
# 品質85で再圧縮すると約1/10（2.6MB → 0.26MB）になり、目視では劣化が判別できない。
#
# ⚠️ PNG（paypay-qr.png 等）は対象外。QRは劣化させないこと。
# ⚠️ このファイルは UTF-8 BOM 付きで保存すること（PowerShell 5.1 対策）。

param(
    [switch]$DryRun,
    [int]$Quality = 85
)

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$dir = Join-Path $PSScriptRoot '..\public\images'
$encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }

$totalBefore = 0
$totalAfter = 0
$rows = @()

foreach ($file in Get-ChildItem -Path $dir -Filter *.jpg) {
    $before = $file.Length
    $totalBefore += $before

    $img = [System.Drawing.Image]::FromFile($file.FullName)
    $tmp = [System.IO.Path]::GetTempFileName() + '.jpg'
    $params = New-Object System.Drawing.Imaging.EncoderParameters 1
    $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]$Quality)
    $img.Save($tmp, $encoder, $params)
    $dimensions = "$($img.Width)x$($img.Height)"
    $img.Dispose()

    $after = (Get-Item $tmp).Length

    # 小さくならない場合は元を維持する（再圧縮でかえって増えるケースを防ぐ）
    if ($after -ge $before) {
        Remove-Item $tmp -Force
        $after = $before
        $rows += [pscustomobject]@{ Name = $file.Name; Dim = $dimensions; Before = $before; After = $after; Note = 'skip' }
    } else {
        if (-not $DryRun) { Move-Item $tmp $file.FullName -Force } else { Remove-Item $tmp -Force }
        $rows += [pscustomobject]@{ Name = $file.Name; Dim = $dimensions; Before = $before; After = $after; Note = '' }
    }
    $totalAfter += $after
}

foreach ($r in $rows) {
    "{0,-20} {1,-10} {2,7:N0} KB -> {3,6:N0} KB  {4}" -f $r.Name, $r.Dim, ($r.Before/1KB), ($r.After/1KB), $r.Note
}

""
"合計: {0:N1} MB -> {1:N1} MB  ({2:N0}% 削減)" -f ($totalBefore/1MB), ($totalAfter/1MB), ((1 - $totalAfter/$totalBefore) * 100)
if ($DryRun) { "`n-DryRun のため書き込みませんでした" }
