# PDF 첫 장 → JPG(가로 2480px = A4 300dpi) + 한국어 OCR 낱말 위치(JSON). 윈도우 내장 기능만 쓴다(Windows.Data.Pdf, Windows.Media.Ocr).
# 사용: .\pdf-page.ps1 -Pdf "C:\...\수매확인서.pdf" -OutJpg "...\page.jpg" -OutOcr "...\ocr.json" [-Width 2480]
param([Parameter(Mandatory = $true)][string]$Pdf, [Parameter(Mandatory = $true)][string]$OutJpg, [string]$OutOcr, [int]$Width = 2480)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime, PresentationCore
[void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
[void][Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
[void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
[void][Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$asTaskG = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
$asTaskA = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
function Await($op, [Type]$t) { $task = $asTaskG.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; return $task.Result }
function AwaitA($op) { $task = $asTaskA.Invoke($null, @($op)); $task.Wait(-1) | Out-Null }

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path $Pdf).Path)) ([Windows.Storage.StorageFile])
$doc = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
if ($doc.PageCount -gt 1) { Write-Warning "PDF 가 $($doc.PageCount)쪽 — 첫 장만 쓴다" }
$page = $doc.GetPage(0)
$opt = New-Object Windows.Data.Pdf.PdfPageRenderOptions
$opt.DestinationWidth = $Width; $opt.DestinationHeight = [uint32][Math]::Round($Width * $page.Size.Height / $page.Size.Width)
$opt.BackgroundColor = [Windows.UI.Color]::FromArgb(255, 255, 255, 255)
$ms = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
AwaitA ($page.RenderToStreamAsync($ms, $opt))

# PNG 스트림 → JPG
$ms.Seek(0); $ns = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($ms)
$dec = [Windows.Media.Imaging.BitmapDecoder]::Create($ns, 'None', 'OnLoad')
$enc = New-Object Windows.Media.Imaging.JpegBitmapEncoder; $enc.QualityLevel = 95; $enc.Frames.Add($dec.Frames[0])
New-Item -ItemType Directory -Force (Split-Path $OutJpg -Parent) | Out-Null
$fs = [IO.File]::Create($OutJpg); $enc.Save($fs); $fs.Close()
"page: {0}x{1} (PDF {2:N0}x{3:N0}pt, A4 비율 {4:N3} / 1.414)" -f $opt.DestinationWidth, $opt.DestinationHeight, $page.Size.Width, $page.Size.Height, ($page.Size.Height / $page.Size.Width)

if ($OutOcr) {
  $ms.Seek(0)
  $wdec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ms)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $sb = Await ($wdec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $eng = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language 'ko'))
  if (-not $eng) { throw '한국어 OCR 을 쓸 수 없음(윈도우 설정 > 언어 > 한국어 기본 입력 기능 설치)' }
  $res = Await ($eng.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])
  $lines = foreach ($l in $res.Lines) {
    [ordered]@{ text = $l.Text; words = @(foreach ($w in $l.Words) { [ordered]@{ t = $w.Text; x = [int]$w.BoundingRect.X; y = [int]$w.BoundingRect.Y; w = [int]$w.BoundingRect.Width; h = [int]$w.BoundingRect.Height } }) }
  }
  $o = [ordered]@{ width = [int]$opt.DestinationWidth; height = [int]$opt.DestinationHeight; lines = @($lines) }
  [IO.File]::WriteAllText($OutOcr, ($o | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false))
  "ocr: $(@($lines).Count) 줄"
}
