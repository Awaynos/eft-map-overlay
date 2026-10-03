Add-Type -AssemblyName System.Drawing
$src = @"
using System;
using System.Runtime.InteropServices;

public static class IconEnum {
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

  public const int RT_GROUP_ICON = 14;
  public const int RT_ICON = 3;
  public const uint LOAD_LIBRARY_AS_DATAFILE = 0x2;
}
"@
Add-Type -TypeDefinition $src

$exe = "E:\SteamLibrary\steamapps\common\Escape from Tarkov\build\EscapeFromTarkov.exe"
$outDir = Join-Path $PSScriptRoot "build"
$hLib = [IconEnum]::LoadLibraryEx($exe, [IntPtr]::Zero, [IconEnum]::LOAD_LIBRARY_AS_DATAFILE)
if ($hLib -eq [IntPtr]::Zero) { Write-Output "LoadLibraryEx failed"; exit 1 }

# Перечисляем RT_ICON ресурсы
$foundZero = [InvalidOperationException]::new
$script:iconResources = New-Object System.Collections.ArrayList
$sizes = @{}
$cb = {
  param($h, $type, $name, $lParam)
  $nameInt = $name.ToInt64()
  $hRes = [IconEnum]::FindResource($h, $name, [IntPtr][IconEnum]::RT_ICON)
  if ($hRes -ne [IntPtr]::Zero) {
    $size = [IconEnum]::SizeofResource($h, $hRes)
    $hData = [IconEnum]::LoadResource($h, $hRes)
    $pData = [IconEnum]::LockResource($hData)
    $bytes = New-Object byte[] $size
    [Runtime.InteropServices.Marshal]::Copy($pData, $bytes, 0, $size)
    if ($size -gt 16) {
      $script:iconResources.Add($bytes) | Out-Null
      $sizes[$bytes.Length] = $nameInt
    }
  }
  return $true
}
$typePtr = [IntPtr][IconEnum]::RT_ICON
[IconEnum]::EnumResourceNames($hLib, $typePtr, $cb, [IntPtr]::Zero) | Out-Null

Write-Output ("RT_ICON ресурсов найдено: {0}" -f $iconResources.Count)
foreach ($b in $iconResources) {
  $isPng = $b.Length -gt 8 -and $b[0] -eq 0x89 -and $b[1] -eq 0x50
  $sig = ""
  if ($isPng) { $sig = "PNG" }
  Write-Output ("size={0} bytes first={1:X2} {2:X2} {3:X2} {4:X2} {5}" -f $b.Length, $b[0], $b[1], $b[2], $b[3], $sig)
  if ($isPng) {
    $png = Join-Path $outDir "eft_rticon_$($b.Length).png"
    [System.IO.File]::WriteAllBytes($png, $b)
    Write-Output "  saved $png"
  }
}
[IconEnum]::FreeLibrary($hLib) | Out-Null