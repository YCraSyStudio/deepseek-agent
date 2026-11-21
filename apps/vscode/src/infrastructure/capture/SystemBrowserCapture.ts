import type { ChromiumProvider } from "@/infrastructure/browser/ChromiumProvider";
import { mkdtemp, rm } from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import type { CaptureScreenshotRequest } from "@/contracts/Capture";
import type { CaptureBackend, CaptureFrame } from "./CaptureService";
import { captureCdpViewport } from "./CdpViewport";
import { launchHeadlessBrowser } from "./HeadlessBrowserSession";

export class SystemBrowserCapture implements CaptureBackend {
  readonly timeoutMs = 10 * 60_000;
  constructor(private readonly browsers: Pick<ChromiumProvider, "executable">) {}
  async capture(request: CaptureScreenshotRequest, signal: AbortSignal): Promise<CaptureFrame> {
    signal.throwIfAborted();
    const binary = await this.browsers.executable(signal);
    const temporary = await mkdtemp(path.join(tmpdir(), "ycrasy-web-capture-"));
    let browser: ReturnType<typeof launchHeadlessBrowser> | undefined;
    try {
      browser = launchHeadlessBrowser(binary, path.join(temporary, "profile"), signal);
      const connection = await browser.page();
      await connection.request("Page.enable");
      const navigation = await connection.request("Page.navigate", { url: request.url! });
      if (navigation.errorText) {throw new Error(`Headless page navigation failed: ${String(navigation.errorText).slice(0, 300)}`);}
      const bytes = await captureCdpViewport(connection, request, signal);
      if (bytes.length > 16 * 1024 * 1024) {throw new Error("Browser screenshot exceeds the size limit");}
      return { bytes, target: request.url! };
    } finally {
      try {await browser?.dispose();}
      finally {await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });}
    }
  }
}
