# Resolve MSIX AppData redirection without changing Windows virtualization/security settings.
$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class RuntimeDirectoryHandle {
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
 public static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
 public static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder buffer, uint size, uint flags);
}
'@
try {
 $root=Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'HS-LMS-Notifier'
 [IO.Directory]::CreateDirectory($root) | Out-Null
 $handle=[RuntimeDirectoryHandle]::CreateFile($root,0,7,[IntPtr]::Zero,3,0x02000000,[IntPtr]::Zero)
 try {
  if ($handle.IsInvalid) { throw 'Invalid directory handle' }
  $buffer=[Text.StringBuilder]::new(32768)
  $size=[RuntimeDirectoryHandle]::GetFinalPathNameByHandle($handle,$buffer,32768,0)
  if ($size -eq 0 -or $size -ge 32768) { throw 'Cannot resolve directory' }
  $path=$buffer.ToString()
  if ($path.StartsWith('\\?\')) { $path=$path.Substring(4) }
  @{root=$path} | ConvertTo-Json -Compress
 } finally { $handle.Dispose() }
}catch { exit 1 }
