Add-Type -AssemblyName System.Drawing
$src = @"
using System;
using System.Runtime.InteropServices;
public static class IconEx2 {
  [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern IntPtr LoadImage(IntPtr hinst, string lpszName, uint uType, int cx, int cy, uint fuLoad);
  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern IntPtr LoadLibraryEx(string lpFileName, IntPtr hFile, uint dwFlags);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool FreeLibrary(IntPtr hModule);
  [DllImport("user32.dll")]
  public static extern bool DestroyIcon(IntPtr hIcon);
}
"@
Add-Type -TypeDefinition $src

$exe = "E:\SteamLibrary\steamapps\common\Escape from Tarkov\build\EscapeFromTarkov.exe"
$outDir = Join-Path $PSScriptRoot "build"
$hLib = [IconEx2]::LoadLibraryEx($exe, [IntPtr]::Zero, 0x2 -bor 0x20)
if ($hLib -eq [IntPtr]::Zero) { Write-Output "LoadLibraryEx failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"; exit 1 }

$best = 0; $hBest = [IntPtr]::Zero; $found = $false
foreach ($id in @("#1","#2","#3","#4","#5","#6","#7","#8","#32512","#32513")) {
  try {
    $h = [IconEx2]::LoadImage($hLib, $id, 1, 0, 0, 0)  # IMAGE_ICON=1, cx/cy=0 => original size
    if ($h -ne [IntPtr]::Zero) {
      $icon = [System.Drawing.Icon]::FromHandle($h)
      Write-Output ("Found {0} size {1}x{2}" -f $id, $icon.Width, $icon.Height)
      if ($icon.Width -gt $best) { $best = $icon.Width; $hBest = $h }
      $found = $true
      [IconEx2]::DestroyIcon($h) | Out-Null
    }
  } catch {}
}
if ($hBest -ne [IntPtr]::Zero) {
  $icon = [System.Drawing.Icon]::FromHandle($hBest)
  $bmp = $icon.ToBitmap()
  $png = Join-Path $outDir "eft_original.png"
  $bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output ("BEST: {0}x{1} saved to {2}" -f $bmp.Width, $bmp.Height, $png)
} else {
  Write-Output "In exe not found large icon (found=$found)"
}
[IconEx2]::FreeLibrary($hLib) | Out-Null