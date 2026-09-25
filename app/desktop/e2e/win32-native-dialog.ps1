param(
  [Parameter(Mandatory=$true)][string]$Mode,
  [string]$A1,
  [string]$A2,
  [string]$A3
)
# win32 helper for native-report-export.mjs. Provides the xwininfo/XTest
# equivalents via EnumWindows / UI Automation / System.Drawing.
# tree: prints every visible top-level window as `0xhwnd "title"`, and adds
#       an alias line `0xhwnd "Save File"` for the save dialog (keeps the
#       driver's existing regex working).
# NOTE: this file must stay pure ASCII. PS5.1 reads ps1 files as ANSI when
# no BOM is present; a UTF-8 lead byte at a comment line end can consume
# the newline and merge the following code line into the comment.
Add-Type -AssemblyName System.Drawing, System.Windows.Forms, UIAutomationClient, UIAutomationTypes
$src = @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class NW {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll", EntryPoint="SendMessageW")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="SendMessageW")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, string l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool SetWindowText(IntPtr h, string s);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool c);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] p, int cb);
  [StructLayout(LayoutKind.Explicit, Size=40)] public struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort vk; public ushort scan; public uint flags; public uint time; public IntPtr extra; }
  public static uint Key(ushort vk, bool up) {
    INPUT i; i.type = 1; i.ki.vk = vk; i.ki.scan = 0; i.ki.flags = up ? 2u : 0u; i.ki.time = 0; i.ki.extra = IntPtr.Zero;
    return SendInput(1, new INPUT[] { i }, System.Runtime.InteropServices.Marshal.SizeOf(typeof(INPUT)));
  }
  public static uint Char(char c, bool up) {
    INPUT i; i.type = 1; i.ki.vk = 0; i.ki.scan = (ushort)c; i.ki.flags = (up ? 2u : 0u) | 4u; i.ki.time = 0; i.ki.extra = IntPtr.Zero;
    return SendInput(1, new INPUT[] { i }, System.Runtime.InteropServices.Marshal.SizeOf(typeof(INPUT)));
  }
  public static List<IntPtr> Children(IntPtr p) {
    var l = new List<IntPtr>();
    EnumChildWindows(p, (h, x) => { l.Add(h); return true; }, IntPtr.Zero);
    return l;
  }
  public static string ClassOf(IntPtr h) {
    var sb = new StringBuilder(128);
    GetClassNameW(h, sb, sb.Capacity);
    return sb.ToString();
  }
  public static string TextOf(IntPtr h) {
    var sb = new StringBuilder(512);
    GetWindowTextW(h, sb, sb.Capacity);
    return sb.ToString();
  }
  public static void FocusSteal(IntPtr h) {
    uint dummy;
    uint fg = GetWindowThreadProcessId(GetForegroundWindow(), out dummy);
    uint me = GetCurrentThreadId();
    AttachThreadInput(me, fg, true);
    BringWindowToTop(h);
    SetForegroundWindow(h);
    AttachThreadInput(me, fg, false);
  }
  public struct RECT { public int Left, Top, Right, Bottom; }
  public class Info { public IntPtr Hwnd; public string Title; public string Cls; public uint Pid; }
  public static List<Info> All() {
    var list = new List<Info>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var t = new StringBuilder(512); GetWindowTextW(h, t, t.Capacity);
      var c = new StringBuilder(128); GetClassNameW(h, c, c.Capacity);
      uint pid; GetWindowThreadProcessId(h, out pid);
      list.Add(new Info { Hwnd = h, Title = t.ToString(), Cls = c.ToString(), Pid = pid });
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
"@
Add-Type -TypeDefinition $src -ReferencedAssemblies System.Drawing, System.Windows.Forms

# ja-JP strings are built from char codes to keep this file ASCII.
$jaSave1 = [string]::Concat([char]0x540d, [char]0x524d, [char]0x3092, [char]0x4ed8, [char]0x3051, [char]0x3066, [char]0x4fdd, [char]0x5b58)
$jaSave2 = [string]::Concat([char]0x540d, [char]0x524d, [char]0x3092, [char]0x3064, [char]0x3051, [char]0x3066, [char]0x4fdd, [char]0x5b58)
$saveTitle = "(?i)(save as|save file|$jaSave1|$jaSave2)"
$jaSaveWord = [string]::Concat([char]0x4fdd, [char]0x5b58)
$jaCancelWord = [string]::Concat([char]0x30ad, [char]0x30e3, [char]0x30f3, [char]0x30bb, [char]0x30eb)
$jaFileNameWord = [string]::Concat([char]0x30d5, [char]0x30a1, [char]0x30a4, [char]0x30eb, [char]0x540d)

# A save dialog qualifies only when it lives in the same process as the
# FigDiff window: Chromium opens common dialogs unowned, so owner-based
# filtering cannot identify them, but the dialog HWND belongs to the
# browser process. Stray dialogs from other apps must not satisfy the
# driver's open/close detection.
function Get-AppPid {
  # Title alone is not enough: other Electron apps (e.g. IDE windows named
  # after the repo) can carry 'FigDiff' in the title. Require the owning
  # process to be electron/figdiff as well.
  foreach ($w in [NW]::All()) {
    if ($w.Title -notmatch 'FigDiff') { continue }
    $procId = [uint32]0
    [void][NW]::GetWindowThreadProcessId($w.Hwnd, [ref]$procId)
    if ($procId -eq 0) { continue }
    $pname = ''
    try { $pname = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { }
    if ($pname -match '(?i)electron|figdiff') { return $procId }
  }
  return 0
}
function Test-AppDialog([IntPtr]$h, [int]$appPid) {
  if ($appPid -eq 0) { return $false }
  $procId = [uint32]0
  [void][NW]::GetWindowThreadProcessId($h, [ref]$procId)
  return $procId -eq $appPid
}

switch ($Mode) {
  'tree' {
    $dbg = @()
    $appPid = if ($A1) { [int]$A1 } else { Get-AppPid }
    foreach ($w in [NW]::All()) {
      if ($w.Title.Length -eq 0) { continue }
      $hex = '0x{0:x}' -f $w.Hwnd.ToInt64()
      Write-Output "$hex `"$($w.Title)`""
      if ($w.Title -match $saveTitle) {
        $wpid = [uint32]0
        [void][NW]::GetWindowThreadProcessId($w.Hwnd, [ref]$wpid)
        $dbg += "$hex title='$($w.Title)' pid=$wpid appPid=$appPid"
        if (Test-AppDialog $w.Hwnd $appPid) {
          Write-Output "$hex `"Save File`""
        }
      }
    }
    if ($dbg.Count -gt 0) {
      [IO.File]::WriteAllText("$env:TEMP\figdiff-tree-dbg.txt", ($dbg -join "`r`n"))
    }
  }
  'find' {
    $appPid = if ($A1) { [int]$A1 } else { Get-AppPid }
    $hit = [NW]::All() | Where-Object { $_.Title -match $saveTitle -and (Test-AppDialog $_.Hwnd $appPid) } | Select-Object -First 1
    if ($null -eq $hit) { exit 1 }
    Write-Output ('0x{0:x}' -f $hit.Hwnd.ToInt64())
  }
  'shot' {
    $hwnd = [IntPtr]([Convert]::ToInt64(($A1 -replace "^0x",""), 16))
    $r = New-Object NW+RECT
    if (-not [NW]::GetWindowRect($hwnd, [ref]$r)) { exit 1 }
    $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
    if ($w -le 0 -or $h -le 0) { exit 1 }
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
    $bmp.Save($A2, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
  }
  'dump' {
    $hwnd = [IntPtr]([Convert]::ToInt64(($A1 -replace "^0x",""), 16))
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($e in $all) {
      $ct = $e.Current.ControlType.ProgrammaticName
      $pats = ($e.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName }) -join ','
      Write-Output "$ct | name='$($e.Current.Name)' | aid='$($e.Current.AutomationId)' | $pats"
    }
  }
  'save' {
    # A1=hwnd, A2=destination path. Focus-based input (SendInput/SendKeys)
    # is racy: any foreground window can steal keys mid-type. Instead write
    # the filename Edit directly via WM_CHAR and click the real Save button
    # with BM_CLICK - neither requires focus nor z-order.
    $hwnd = [IntPtr]([Convert]::ToInt64(($A1 -replace "^0x",""), 16))
    $appPid = if ($A3) { [int]$A3 } else { Get-AppPid }
    Add-Content "$env:TEMP\figdiff-save-dbg.txt" "save start hwnd=$hwnd appPid=$appPid"
    $children = [NW]::Children($hwnd)
    Add-Content "$env:TEMP\figdiff-save-dbg.txt" "children=$($children.Count)"
    $dbg = @()
    foreach ($c in $children) {
      $dbg += "0x$($c.ToInt64().ToString('x')) cls='$([NW]::ClassOf($c))' id=$([NW]::GetDlgCtrlID($c)) parent-cls='$([NW]::ClassOf([NW]::GetParent($c)))' text='$([NW]::TextOf($c))'"
    }
    [IO.File]::WriteAllText("$env:TEMP\figdiff-dialog-dump.txt", ($dbg -join "`r`n"))
    # The filename Edit sits inside a plain ComboBox hosted by
    # FloatNotifySink; the address bar Edit sits in a ComboBox under
    # ComboBoxEx32. Distinguish by the grandparent class.
    $editHwnd = $null
    foreach ($c in $children) {
      if ([NW]::ClassOf($c) -ne 'Edit') { continue }
      $p = [NW]::GetParent($c)
      if ([NW]::ClassOf($p) -ne 'ComboBox') { continue }
      $gp = [NW]::GetParent($p)
      if ([NW]::ClassOf($gp) -eq 'FloatNotifySink') { $editHwnd = $c; break }
    }
    if ($null -eq $editHwnd) {
      foreach ($c in $children) {
        if ([NW]::ClassOf($c) -eq 'Edit' -and [NW]::ClassOf([NW]::GetParent($c)) -eq 'ComboBox') { $editHwnd = $c; break }
      }
    }
    if ($null -eq $editHwnd) { Write-Error 'filename edit not found'; exit 1 }
    Add-Content "$env:TEMP\figdiff-save-dbg.txt" "edit=0x$($editHwnd.ToInt64().ToString('x'))"
    # WM_SETTEXT alone does not reach the IFileDialog's internal filename
    # state. Typing via WM_CHAR goes through the combo's normal edit-change
    # notification chain, which is what the dialog reads on OK.
    [void][NW]::SendMessage($editHwnd, 0x000C, [IntPtr]::Zero, "")
    foreach ($ch in $A2.ToCharArray()) {
      [void][NW]::PostMessage($editHwnd, 0x0102, [IntPtr][int][char]$ch, [IntPtr]::Zero)
    }
    Start-Sleep -Milliseconds 400
    Add-Content "$env:TEMP\figdiff-save-dbg.txt" "typed text-now='$([NW]::TextOf($editHwnd))'"
    Add-Content "$env:TEMP\figdiff-dialog-dump.txt" "`r`nUSED edit=0x$($editHwnd.ToInt64().ToString('x')) text-now='$([NW]::TextOf($editHwnd))'"
    # Click the real Save button: class Button with control id 1 (IDOK),
    # via BM_CLICK (0x00F5) posted to the button itself.
    $btn = $null
    foreach ($c in $children) {
      if ([NW]::ClassOf($c) -eq 'Button' -and [NW]::GetDlgCtrlID($c) -eq 1) { $btn = $c; break }
    }
    if ($null -eq $btn) { Write-Error 'save button not found'; exit 1 }
    # PostMessage, not SendMessage: when the target exists the dialog shows
    # a modal overwrite prompt, and SendMessage would block inside the
    # click until that prompt closes - a deadlock the caller cannot see.
    [void][NW]::PostMessage($btn, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
    Add-Content "$env:TEMP\figdiff-save-dbg.txt" "clicked done"
    # Answer the overwrite prompt if one appears: it is another save-titled
    # top-level window in the same process (its buttons may be windowless
    # DirectUI, so click it via WM_COMMAND IDYES/IDOK + Enter instead).
    $deadline = [DateTime]::Now.AddSeconds(5)
    while ([DateTime]::Now -lt $deadline) {
      $prompt = $null
      foreach ($w in [NW]::All()) {
        if ($w.Hwnd -eq $hwnd) { continue }
        if ($w.Title -notmatch $saveTitle) { continue }
        if (-not (Test-AppDialog $w.Hwnd $appPid)) { continue }
        $prompt = $w.Hwnd; break
      }
      if ($null -ne $prompt) {
        [void][NW]::PostMessage($prompt, 0x111, [IntPtr]6, [IntPtr]::Zero)
        [void][NW]::PostMessage($prompt, 0x111, [IntPtr]1, [IntPtr]::Zero)
        [void][NW]::PostMessage($prompt, 0x100, [IntPtr]0x0D, [IntPtr]::Zero)
        [void][NW]::PostMessage($prompt, 0x101, [IntPtr]0x0D, [IntPtr]::Zero)
        Add-Content "$env:TEMP\figdiff-save-dbg.txt" "overwrite-yes posted hwnd=0x$($prompt.ToInt64().ToString('x'))"
        break
      }
      Start-Sleep -Milliseconds 250
    }
  }
  'cancel' {
    $hwnd = [IntPtr]([Convert]::ToInt64(($A1 -replace "^0x",""), 16))
    $children = [NW]::Children($hwnd)
    $btn = $null
    foreach ($c in $children) {
      if ([NW]::ClassOf($c) -eq 'Button' -and [NW]::GetDlgCtrlID($c) -eq 2) { $btn = $c; break }
    }
    if ($null -eq $btn) { Write-Error 'cancel button not found'; exit 1 }
    [void][NW]::SendMessage($btn, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
  }
  default { exit 2 }
}
