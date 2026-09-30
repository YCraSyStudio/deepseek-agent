import { runCaptureHelper } from "./HelperProcess";
export interface NativeWindow { id: string; pid: number; title: string; x: number; y: number; width: number; height: number; visible: boolean; occluded?: boolean }
export function parseX11Windows(output: string): NativeWindow[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = /^(0x[0-9a-f]+)\s+(-?\d+)\s+(\d+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+\S+\s+(.*)$/i.exec(line);
    if (!match) {return [];}
    const [, id, desktop, pid, x, y, width, height, title] = match;
    return [{ id, pid: Number(pid), title, x: Number(x), y: Number(y), width: Number(width), height: Number(height), visible: Number(desktop) >= -1 && Number(width) > 0 && Number(height) > 0 }];
  });
}
export function parseNativeWindows(output: string): NativeWindow[] {
  const value: unknown = JSON.parse(output);
  const windows = Array.isArray(value) ? value : value ? [value] : [];
  if (windows.length > 10000) {throw new Error("Window catalog exceeds its limit");}
  return windows.filter((entry): entry is NativeWindow => !!entry && typeof entry.id === "string" && /^(0x[0-9a-f]+|\d+)$/i.test(entry.id) &&
    Number.isSafeInteger(entry.pid) && entry.pid > 0 && typeof entry.title === "string" && entry.title.length <= 4096 &&
    [entry.x, entry.y, entry.width, entry.height].every(Number.isFinite) && entry.width > 0 && entry.height > 0 && typeof entry.visible === "boolean");
}
export function resolveNativeWindow(windows: NativeWindow[], selector: { window?: string; process?: string }, debugPid?: number): NativeWindow {
  const pid = selector.process === undefined ? debugPid : /^\d+$/.test(selector.process) ? Number(selector.process) : undefined;
  if (selector.process && (!pid || !Number.isSafeInteger(pid))) {throw new Error("process must be an exact numeric PID; use an exact window title otherwise");}
  if (!selector.window && !pid) {throw new Error("No process is anchored to the active debug session; supply an explicit PID or exact title");}
  const matches = windows.filter((window) => window.visible && (!pid || window.pid === pid) && (!selector.window || window.id === selector.window || window.title === selector.window));
  if (!matches.length) {throw new Error("Requested native window is not visible or does not exist");}
  if (matches.length !== 1) {throw new Error("Window selector is ambiguous; supply the exact window id");}
  return matches[0];
}
export const WINDOWS_CATALOG = `Add-Type @'
using System; using System.Runtime.InteropServices; using System.Text; using System.Collections.Generic;
public class Catalog {
 public delegate bool Callback(IntPtr h, IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback cb, IntPtr p);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 public struct Rect {public int Left,Top,Right,Bottom;}
 public class Window {public string id,title; public uint pid; public int x,y,width,height; public bool visible;}
 public static Window[] List() {SetProcessDPIAware(); var list=new List<Window>(); EnumWindows((h,p)=>{uint pid; Rect r; var title=new StringBuilder(4096); GetWindowThreadProcessId(h,out pid); GetWindowText(h,title,title.Capacity); if(GetWindowRect(h,out r) && IsWindowVisible(h) && !IsIconic(h) && r.Right>r.Left && r.Bottom>r.Top) list.Add(new Window{id=h.ToInt64().ToString(),pid=pid,title=title.ToString(),x=r.Left,y=r.Top,width=r.Right-r.Left,height=r.Bottom-r.Top,visible=true}); return true;},IntPtr.Zero); return list.ToArray();}
}
'@
ConvertTo-Json -Compress -InputObject @([Catalog]::List())`;
export const MAC_CATALOG = `ObjC.import('CoreGraphics'); var list=ObjC.deepUnwrap($.CGWindowListCopyWindowInfo(1,0)); JSON.stringify(list.filter(w=>w.kCGWindowLayer===0).map(w=>({id:String(w.kCGWindowNumber),pid:w.kCGWindowOwnerPID,title:w.kCGWindowName||w.kCGWindowOwnerName,x:w.kCGWindowBounds.X,y:w.kCGWindowBounds.Y,width:w.kCGWindowBounds.Width,height:w.kCGWindowBounds.Height,visible:w.kCGWindowIsOnscreen!==false})))`;
export async function listNativeWindows(signal: AbortSignal): Promise<NativeWindow[]> {
  if (process.platform === "linux") {
    if (process.env.XDG_SESSION_TYPE === "wayland" || process.env.WAYLAND_DISPLAY) {throw new Error("Wayland window capture requires portal consent and is unavailable; no screen fallback will be attempted");}
    if (!process.env.DISPLAY) {throw new Error("An X11 desktop display is required for native capture");}
    return parseX11Windows((await runCaptureHelper("wmctrl", ["-lpG"], signal)).stdout);
  }
  if (process.platform === "win32") {return parseNativeWindows((await runCaptureHelper("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_CATALOG], signal)).stdout);}
  if (process.platform === "darwin") {return parseNativeWindows((await runCaptureHelper("/usr/bin/osascript", ["-l", "JavaScript", "-e", MAC_CATALOG], signal)).stdout);}
  throw new Error("Native capture is unsupported on this platform");
}
