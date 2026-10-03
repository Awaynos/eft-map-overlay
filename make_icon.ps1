# Собирает мультиразмерный .ico из RT_ICON ресурсов EscapeFromTarkov.exe
Add-Type -AssemblyName System.Drawing
$src = @"
using System;
using System.Runtime.InteropServices;
public static class IconEnum2 {
  public delegate bool EnumResNameProc(IntPtr hModule, IntPtr lpszType, IntPtr lpszName, IntPtr lParam);
  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern IntPtr LoadLibraryEx(string lpFileName, IntPtr hFile, uint dwFlags);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool FreeLibrary(IntPtr hModule);
  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern bool EnumResourceNames(IntPtr hModule, IntPtr lpszType, EnumResNameProc lpEnumFunc, IntPtr lParam);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr FindResource(IntPtr hModule, IntPtr lpName, IntPtr lpType);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr LoadResource(IntPtr hModule, IntPtr hResInfo);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr LockResource(IntPtr hResData);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern uint SizeofResource(IntPtr hModule, IntPtr hResInfo);
  public const int RT_ICON = 3;
  public const uint LOAD_LIBRARY_AS_DATAFILE = 0x2;
}
"@
Add-Type -TypeDefinition $src

$exe = "E:\SteamLibrary\steamapps\common\Escape from Tarkov\build\EscapeFromTarkov.exe"
$outIco = Join-Path $PSScriptRoot "build\icon.ico"

$hLib = [IconEnum2]::LoadLibraryEx($exe, [IntPtr]::Zero, [IconEnum2]::LOAD_LIBRARY_AS_DATAFILE)
if ($hLib -eq [IntPtr]::Zero) { Write-Output "LoadLibraryEx failed"; exit 1 }

$resources = New-Object System.Collections.ArrayList
$cb = {
  param($h, $type, $name, $lParam)
  $hRes = [IconEnum2]::FindResource($h, $name, [IntPtr][IconEnum2]::RT_ICON)
  if ($hRes -ne [IntPtr]::Zero) {
    $size = [IconEnum2]::SizeofResource($h, $hRes)
    $hData = [IconEnum2]::LoadResource($h, $hRes)
    $pData = [IconEnum2]::LockResource($hData)
    $bytes = New-Object byte[] $size
    [Runtime.InteropServices.Marshal]::Copy($pData, $bytes, 0, $size)
    if ($size -gt 40 -and $bytes[0] -eq 40) {
      $w = [BitConverter]::ToInt32($bytes, 4)
      $hgt = [BitConverter]::ToInt32($bytes, 8) / 2
      $bpp = [BitConverter]::ToUInt16($bytes, 14)
      $script:resources.Add([pscustomobject]@{ Width = $w; Height = $hgt; Bpp = $bpp; Data = $bytes }) | Out-Null
    }
  }
  return $true
}
[IconEnum2]::EnumResourceNames($hLib, [IntPtr][IconEnum2]::RT_ICON, $cb, [IntPtr]::Zero) | Out-Null
[IconEnum2]::FreeLibrary($hLib) | Out-Null

Write-Output ("Иконок извлечено: {0}" -f $resources.Count)
$resources | Sort-Object Width | ForEach-Object { Write-Output ("  {0}x{1} bpp={2} bytes={3}" -f $_.Width, $_.Height, $_.Bpp, $_.Data.Length) }

# Сортируем по убыванию размера, берём по одному каждого размера
$unique = $resources | Sort-Object Width -Descending | Group-Object Width | ForEach-Object { $_.Group[0] } | Sort-Object Width
# Порядок в ICO по одиночке; уберём дубли, оставим: 256,128,64,48,32,16
$want = @(256,128,64,48,32,16,24,20)
$entries = @()
foreach ($w in $want) {
  $item = $unique | Where-Object { $_.Width -eq $w } | Select-Object -First 1
  if ($item) { $entries += $item }
}
if (-not $entries) { Write-Output "Нет иконок"; exit 1 }

# Строим ICO: заголовок + директории + данные
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([byte]0); $bw.Write([byte]0)                 # reserved
$bw.Write([int16]1)                                    # type = icon
$bw.Write([int16]$entries.Count)                       # count

$dataStart = 6 + 16 * $entries.Count
$offset = $dataStart
foreach ($e in $entries) {
  $b = $e.Data
  $bw.Write([byte]($(if ($e.Width -ge 256) {0} else {$e.Width})))   # width (0 = 256)
  $bw.Write([byte]($(if ($e.Height -ge 256) {0} else {$e.Height}))) # height
  $bw.Write([byte]0)                                   # palette
  $bw.Write([byte]0)                                   # reserved
  $bw.Write([int16]1)                                  # planes
  $bw.Write([int16]$e.Bpp)                             # bitcount
  $bw.Write([int32]$b.Length)                          # bytes in resource
  $bw.Write([int32]$offset)                            # offset
  $offset += $b.Length
}
foreach ($e in $entries) { $bw.Write($e.Data) }
$bw.Flush()
[System.IO.File]::WriteAllBytes($outIco, $ms.ToArray())
$bw.Dispose(); $ms.Dispose()
$fi = Get-Item $outIco
Write-Output ("ICO сохранён: {0} ({1} байт)" -f $outIco, $fi.Length)