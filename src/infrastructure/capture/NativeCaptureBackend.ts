import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import type { CaptureScreenshotRequest } from "@/contracts/Capture";
import type { CaptureBackend, CaptureFrame } from "./CaptureService";
import { listNativeWindows, resolveNativeWindow, type NativeWindow } from "./NativeWindowCatalog";
import { runCaptureHelper } from "./HelperProcess";
import { isUniformNativeCapture } from "./NativePixelValidation";

export function windowsCaptureScript(window: NativeWindow | undefined, destination: string): string {
  const id = window?.id ?? "0";
  if (!/^\d+$/.test(id)) {throw new Error("Invalid Windows window handle");}
  return `Add-Type -AssemblyName System.Drawing
Add-Type @'
using System; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public class Capture {
 [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
 public delegate bool Callback(IntPtr h,IntPtr p);
 [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback,IntPtr p);
 static bool Occluded(IntPtr target,Rect rect) {
  bool occluded=false,found=false;
  EnumWindows((h,p)=>{if(h==target) {found=true; return false;} Rect other; if(IsWindowVisible(h)&&!IsIconic(h)&&GetWindowRect(h,out other)&&other.Left<rect.Right&&other.Right>rect.Left&&other.Top<rect.Bottom&&other.Bottom>rect.Top) occluded=true; return true;},IntPtr.Zero);
  return !found||occluded;
 }
 public struct Rect {public int Left,Top,Right,Bottom;}
 static bool Uniform(Bitmap b) {var c=b.GetPixel(0,0).ToArgb(); for(int y=0;y<b.Height;y++) for(int x=0;x<b.Width;x++) if(b.GetPixel(x,y).ToArgb()!=c) return false; return true;}
 public static void Save(long id,string file) {
  SetProcessDPIAware(); var h=new IntPtr(id); Rect r;
  if(id==0) r=new Rect{Left=GetSystemMetrics(76),Top=GetSystemMetrics(77),Right=GetSystemMetrics(76)+GetSystemMetrics(78),Bottom=GetSystemMetrics(77)+GetSystemMetrics(79)};
  else if(!IsWindowVisible(h)||IsIconic(h)||!GetWindowRect(h,out r)) throw new Exception("Window is no longer visible");
  int width=r.Right-r.Left,height=r.Bottom-r.Top;
  if(width<=0||height<=0||(long)width*height>20000000) throw new Exception("Window dimensions exceed capture limits");
  using(var bitmap=new Bitmap(width,height,PixelFormat.Format32bppArgb)) using(var g=Graphics.FromImage(bitmap)) {
   bool printed=false;
   if(id!=0) {var dc=g.GetHdc(); try {printed=PrintWindow(h,dc,2);} finally {g.ReleaseHdc(dc);}}
   if(!printed||Uniform(bitmap)) {
    if(id!=0 && Occluded(h,r)) throw new Exception("PrintWindow failed and the window is occluded; make it fully visible before retrying");
    g.CopyFromScreen(r.Left,r.Top,0,0,new Size(width,height),CopyPixelOperation.SourceCopy);
   }
   if(Uniform(bitmap)) throw new Exception("Native capture is uniform/black; GPU output or desktop permissions may prevent capture");
   bitmap.Save(file,ImageFormat.Png);
  }
 }
}
'@ -ReferencedAssemblies System.Drawing
[Capture]::Save(${id},'${destination.replace(/'/g, "''")}')`;
}
export class NativeCaptureBackend implements CaptureBackend {
  constructor(private readonly debugPid: () => number | undefined = () => undefined,
    private readonly catalog = listNativeWindows, private readonly helper = runCaptureHelper) {}
  async capture(request: CaptureScreenshotRequest, signal: AbortSignal): Promise<CaptureFrame> {
    signal.throwIfAborted();
    if (process.platform === "linux" && (process.env.XDG_SESSION_TYPE === "wayland" || process.env.WAYLAND_DISPLAY)) {throw new Error("Wayland capture requires explicit portal consent; native capture is unavailable");}
    const window = request.target === "screen" ? undefined : resolveNativeWindow(await this.catalog(signal), request, request.target === "debug" ? this.debugPid() : undefined);
    if (window && window.width * window.height > 20_000_000) {throw new Error("Window dimensions exceed capture limits");}
    const temporary = await mkdtemp(path.join(tmpdir(), "ycrasy-native-capture-"));
    try {
      const destination = path.join(temporary, "capture.png");
      if (process.platform === "linux") {
        if (!process.env.DISPLAY) {throw new Error("Native capture requires an X11 desktop");}
        await this.helper("import", ["-window", window?.id ?? "root", `PNG24:${destination}`], signal);
      } else if (process.platform === "win32") {await this.helper("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", windowsCaptureScript(window, destination)], signal, 25000);}
      else if (process.platform === "darwin") {await this.helper("/usr/sbin/screencapture", ["-x", "-t", "png", ...(window ? ["-l", window.id] : ["-m"]), destination], signal);}
      else {throw new Error("Native capture is unsupported on this platform");}
      signal.throwIfAborted();
      if ((await stat(destination)).size > 16 * 1024 * 1024) {throw new Error("Native screenshot exceeds capture size limit");}
      const bytes = await readFile(destination);
      if (isUniformNativeCapture(bytes)) {throw new Error("Native capture is uniform/black; GPU rendering or desktop permissions may prevent capture");}
      return { bytes, target: window ? `window:${window.id}` : "full display", windowTitle: window?.title, pid: window?.pid };
    } finally {await rm(temporary, { recursive: true, force: true });}
  }
}
