# DeepSeek Search and Fetch (#67)

This branch replaces SearXNG completely with the standalone DeepSeek Search and Fetch APIs. Existing search-engine settings are discarded when settings are normalized and persisted. The Web search toggle continues to control both tools.

## Contract

- `POST /v1/tools/search`: Bearer authentication; `query`, `count`, `need_content: false`; response `results` includes `url`, `title`, `summary` and `snippet`. Empty results are a successful search.
- `POST /v1/tools/fetch`: same authentication, `{ url }`; response `{ title, content }`, with Markdown content.
- The configured root, `/v1` and `/beta` chat base URLs resolve to `/v1/tools/...` at the same origin. Proxy path prefixes are retained. Credentials never go to a page URL or a redirected API origin.
- Search accepts at most 128 Unicode code points including added site/language operators. The tool retains the existing ten-result bound, public HTTPS policy, per-generation search grants, bounded output and cancellation.
- Fetch retrieval and redirects run at DeepSeek, rather than in the local extension. Returned text remains untrusted and is enclosed by explicit data warnings. Document paging reuses the retained response without another Fetch call.
- Requests have a 30-second deadline including body consumption and a 2 MiB response limit. Failures retain safe HTTP errors, including insufficient balance and rate limiting. POSTs are not retried automatically, and failed searches are not repeated in the same generation.
- There are no runtime binaries, subprocesses, localhost listeners, engine catalogs or SearXNG release checks. Existing on-disk runtime caches are unused; user-owned files/services are not deleted or stopped.

## Validation

Controlled API fixtures check actual endpoint paths, Bearer headers, JSON bodies, summaries, Unicode limits, empty results, unsafe/duplicate URLs, malformed and oversized responses, HTTP 401/402/403/429/5xx, cancellation and credential redirects. Web-tool tests check locale/site filters, per-generation URL ownership and terminal failures. Existing security and settings tests cover explicit URL authorization, inert output, output limits and retired settings.

Verified locally: compile, lint, production build, 481 unit tests, 11 extension-host integration tests in VS Code 1.142.0 on Linux, one installed-VSIX smoke test, VSIX content validation (16 entries), and a documentation check/build (32 checked files, 24 generated pages). The dead-code audit still reports three pre-existing unused exports: `detectImageMediaType`, `ImageMediaType`, and the `ConversationStorage` re-export of `SCREENSHOT_DIRECTORY_NAME`; this migration introduces no new unused exports.

Live acceptance requires an API credential configured in VS Code: enable Web search, ask for a current fact, verify `search_web` returns DeepSeek results, read one result with `read_web`, and inspect source links. Disable Web search and verify neither tool is offered. Verify operation without Python, SearXNG or any local port. No paid live API request is performed by the fixture tests.

## Official sources

Verified 18 October 2026:

- https://api-docs.deepseek.com/zh-cn/guides/search
- https://api-docs.deepseek.com/zh-cn/api/search
- https://api-docs.deepseek.com/zh-cn/api/fetch
- https://api-docs.deepseek.com/zh-cn/quick_start/pricing/

Search and Fetch currently cost CNY 5 per 1,000 successful requests with results; empty searches and failures are not charged. Account limits are separately 5 QPS for Search and Fetch, with additional per-domain Fetch limits. These request charges are not included in the extension’s model-token usage totals. See the live official documentation for current pricing and the separate billing transition for server-side tool calls.
