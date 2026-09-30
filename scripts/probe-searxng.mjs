// Explicit diagnostics probe; never starts/stops a server or persists user queries.
const endpoint = process.argv[2] ?? "http://127.0.0.1:8888";
const query = process.argv[3] ?? "Unity ScreenCapture CaptureScreenshot Game view";
const selections = ["", "!g", "!brave", "!ddg", "!bi"];
async function probe(selection, phase) {
  const url = new URL("search", endpoint.endsWith("/") ? endpoint : `${endpoint}/`);
  url.searchParams.set("q", `${selection} ${query}`.trim()); url.searchParams.set("format", "json");
  const start = performance.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const body = await response.text(); const parsed = JSON.parse(body);
    console.log(JSON.stringify({ at: new Date().toISOString(), phase, selection, status: response.status, ms: Math.round(performance.now() - start), results: parsed.results?.length, engines: [...new Set((parsed.results ?? []).flatMap(result => result.engines ?? []))], unavailable: parsed.unresponsive_engines }));
  } catch (error) {console.log(JSON.stringify({ at: new Date().toISOString(), phase, selection, ms: Math.round(performance.now() - start), error: String(error) }));}
}
for (const selection of selections) {await probe(selection, "sequential");}
await Promise.all(selections.map(selection => probe(selection, "concurrent")));
