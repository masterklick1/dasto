$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class W32 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, int d, int e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, int extra);
}
"@
[void][W32]::SetProcessDPIAware()

# Line protocol (one command per line, answer "OK" or "ERR ..."):
#   move|x|y        move cursor (physical pixels)
#   btn|flag        raw mouse_event flag (2/4 left, 8/16 right, 32/64 middle)
#   wheel|flag|d    wheel (0x800 vertical, 0x1000 horizontal), delta
#   kev|vk|flags    keybd_event (flags 0 = down, 2 = up)
#   keys|base64     SendKeys string (UTF-8, base64)
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  try {
    $p = $line.Split('|')
    switch ($p[0]) {
      'move'  { [void][W32]::SetCursorPos([int]$p[1], [int]$p[2]) }
      'btn'   { [W32]::mouse_event([uint32]$p[1], 0, 0, 0, 0) }
      'wheel' { [W32]::mouse_event([uint32]$p[1], 0, 0, [int]$p[2], 0) }
      'kev'   { [W32]::keybd_event([byte][int]$p[1], 0, [uint32]$p[2], 0) }
      'keys'  { [System.Windows.Forms.SendKeys]::SendWait([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p[1]))) }
    }
    [Console]::Out.WriteLine('OK')
  } catch {
    [Console]::Out.WriteLine('ERR ' + $_.Exception.Message.Replace("`r", ' ').Replace("`n", ' '))
  }
  [Console]::Out.Flush()
}
