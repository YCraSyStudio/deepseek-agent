import type { CdpConnection } from "@/infrastructure/capture/CdpViewport";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchHeadlessBrowser } from "@/infrastructure/capture/HeadlessBrowserSession";
import type { ChromiumProvider } from "./ChromiumProvider";
import { createPublicWebProxy } from "./PublicWebProxy";
import type { WebAccessPolicy } from "./NetworkPolicy";

export interface RenderedPage {
  title: string;
  url: string;
  content: string;
  sections?: string[];
  outline: string[];
  links: Array<{ title: string; url: string; snippet?: string }>;
  contentHash: string;
  injectionRisk: "none" | "suspected";
}

/** Local isolated Chromium rendering; search remains a separate provider operation. */
export class HeadlessWebRuntime {
  private readonly shutdown = new AbortController();
  private active = 0;
  private completed = 0;
  private failed = 0;
  constructor(private readonly browsers: Pick<ChromiumProvider, "executable">, private readonly assertEnabled: () => void = () => undefined) {}

  async render(url: string, policy: WebAccessPolicy, signal?: AbortSignal): Promise<RenderedPage> {
    this.assertEnabled();
    const authorized = policy.assertNavigationAllowed(url).toString();
    const lifetime = AbortSignal.any([this.shutdown.signal, ...(signal ? [signal] : [])]);
    lifetime.throwIfAborted();
    const binary = await this.browsers.executable(lifetime);
    const combined = AbortSignal.any([lifetime, AbortSignal.timeout(30_000)]);
    const temporary = await mkdtemp(join(tmpdir(), "ycrasy-web-read-"));
    let browser: ReturnType<typeof launchHeadlessBrowser> | undefined;
    let proxy: Awaited<ReturnType<typeof createPublicWebProxy>> | undefined;
    this.active++;
    try {
      proxy = await createPublicWebProxy(combined);
      browser = launchHeadlessBrowser(binary, join(temporary, "profile"), combined, [
        `--proxy-server=${proxy.url}`, "--proxy-bypass-list=<-loopback>", "--disable-quic",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
      ]);
      const page = await browser.page();
      await page.request("Page.enable");
      // Validate every document navigation, including redirects and script-triggered navigations.
      page.on!("Fetch.requestPaused", (event) => {
        const request = event.request as { url?: string; method?: string } | undefined;
        let allowed = request?.method === "GET";
        try {policy.assertNavigationAllowed(request?.url ?? "");} catch {allowed = false;}
        void page.request(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", {
          requestId: event.requestId, ...(!allowed ? { errorReason: "BlockedByClient" } : {}),
        }).catch(() => undefined);
      });
      await page.request("Fetch.enable", { patterns: [{ resourceType: "Document", requestStage: "Request" }] });
      const navigation = await page.request("Page.navigate", { url: authorized });
      if (navigation.errorText) {throw new Error(`Web navigation failed: ${String(navigation.errorText).slice(0, 200)}`);}
      const value = await readChromiumDocument(page, combined);
      policy.assertNavigationAllowed(value.url);
      const result = createRenderedPage(value.title, value.url, value.content);
      this.completed++;
      return result;
    } catch (error) {this.failed++; throw error;}
    finally {
      this.active--;
      try {await browser?.dispose();}
      finally {await proxy?.close(); await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });}
    }
  }

  getDiagnostics(): Record<string, unknown> {
    return { source: "local-chromium", available: !this.shutdown.signal.aborted, active: this.active, completed: this.completed, failed: this.failed };
  }
  async dispose(): Promise<void> {this.shutdown.abort(new Error("Web runtime disposed"));}
}

async function readChromiumDocument(page: CdpConnection, signal: AbortSignal): Promise<{ title: string; url: string; content: string }> {
  const extraction = await page.request("Runtime.evaluate", { expression: `new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Page load timed out')), 7000);
    const read = () => setTimeout(() => {
      clearTimeout(timer);
      const root = document.querySelector('main, article, [role="main"]') || document.body;
      const clone = root?.cloneNode(true);
      clone?.querySelectorAll('script, style, iframe, object, nav, footer, noscript, [hidden], [aria-hidden="true"]').forEach(node => node.remove());
      clone?.querySelectorAll('h1,h2,h3,h4,h5,h6,p,div,section,pre,li,br,tr').forEach(node => {
        node.before(document.createTextNode('\\n')); node.after(document.createTextNode('\\n'));
      });
      resolve({title: document.title, url: location.href, content: (clone?.textContent || '').slice(0, 524288)});
    }, 300);
    document.readyState === 'complete' ? read() : window.addEventListener('load', read, {once: true});
  })`, awaitPromise: true, returnByValue: true });
  signal.throwIfAborted();
  const value = (extraction.result as { value?: { title: string; url: string; content: string } } | undefined)?.value;
  if (extraction.exceptionDetails || !value) {throw new Error("The web page could not be read before its loading deadline");}
  return value;
}

export function createRenderedPage(title: string, url: string, rawContent: string): RenderedPage {
  const content = rawContent.replace(/<(script|style|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "").trim();
  if (!content) {throw new Error("The web page did not return readable text content");}
  return {
    title, url, content, sections: [content], outline: [], links: [],
    contentHash: createHash("sha256").update(content).digest("hex"),
    injectionRisk: detectPromptInjection(content) ? "suspected" : "none",
  };
}

export function detectPromptInjection(content: string): boolean {
  const normalized = content.normalize("NFKC").toLowerCase();
  return [
    /ignore (?:all |any )?(?:previous|prior|system) instructions/,
    /reveal (?:the )?(?:system prompt|developer message|secret|api key)/,
    /you are now (?:a|an|in) /,
    /(?:execute|run) (?:this|the following) (?:command|tool)/,
    /do not tell the user/,
    /(?:system|developer) (?:message|instruction|prompt)/,
    /(?:upload|send|exfiltrate) .{0,80}(?:secret|credential|token|key|file)/,
    /(?:call|invoke|use) .{0,40}(?:tool|function)/,
    /<\|(?:system|developer|assistant)\|>|\[inst\]/,
  ].some((pattern) => pattern.test(normalized));
}
