# DeepSeek Search and Fetch (#67)

## Development defaults, regional preference and privacy

Search now requests eight results by default (up to 50 on demand), retains available page content for `read_web`, and preserves relevance, authority, publication date and site metadata. Documents share the existing bounded cache and generation ownership. Search output stays below eight KiB and does not include full page bodies. Higher-ranked pages are retained preferentially when the cache fills. Missing content falls back to Fetch; repeated reads and pagination reuse retained content.

Search is global by default. The user may select a country or Automatic to use the local system locale's country code. An explicit per-search country/global request overrides the setting, as instructed through the model's tool guidance. This is not a deterministic natural-language country detector. Regional preference is bounded textual context in `ori_question`, not a guaranteed geographic ranking or verified physical location. Remote hosts do not infer the user's country from the server locale. No public-IP lookup or `localization` address is used. Default technical research keeps English sources available; language is restricted only when explicitly requested.

Privacy settings enable best-effort automatic metadata minimization by default. Generated runtime notices and duplicate review metadata omit absolute workspace roots, optional user IDs are omitted, image upload filenames are generic, image references omit display names, and generated timestamps use UTC without the local time-zone name. Required root aliases, relative paths, file IDs and tool references remain usable. User content, tool output, image pixels/embedded metadata and existing history are not rewritten. The provider still sees the connection IP and authentication information; this does not establish anonymity or GDPR compliance.

These changes use controlled API fixtures and local verification without paid live API calls. No claim is made about measured search quality by country. The earlier implementation and live acceptance below describe the 18 October baseline.

## Original implementation and acceptance

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

Verified locally: compile, lint, production build, 482 unit tests, 11 extension-host integration tests in VS Code 1.142.0 on Linux, one installed-VSIX smoke test, VSIX content validation (16 entries), and a documentation check/build (32 checked files, 24 generated pages). The dead-code audit still reports three pre-existing unused exports: `detectImageMediaType`, `ImageMediaType`, and the `ConversationStorage` re-export of `SCREENSHOT_DIRECTORY_NAME`; this migration introduces no new unused exports.

Live acceptance requires an API credential configured in VS Code: enable Web search, ask for a current fact, verify `search_web` returns DeepSeek results, read one result with `read_web`, and inspect source links. Disable Web search and verify neither tool is offered. Verify operation without Python, SearXNG or any local port. No paid live API request is performed by the fixture tests.

## Live API acceptance — 18 October 2026

With a temporary user-authorized credential, the actual tool handlers successfully searched the official documentation, fetched a returned page, and passed bounded source text to Flash. A separate live model loop then selected `search_web`, selected `read_web` with its returned search ID and URL, and answered with the documented `/v1/tools/search` and `/v1/tools/fetch` endpoints and the consulted HTTPS link. Captured model arguments also passed the extension's tool-registry validation.

The first model loop failed because `read_web` rejected the model's argument combination with `search_id`. The interface now makes the reading modes explicit: opening a search result supports `focus` and its `query` alias, while paging cursors still require a retained `document_id`. A regression test covers focused search-result reads, missing optional values, and rejection of fabricated first-read cursors. The subsequent recorded live model loop completed successfully.

All live attempts together used three Search requests, two Fetch requests, and six capped Flash completions. Reported usage and the official Sunday off-peak prices give an estimated total of **CNY 0.0325856**, below the CNY 10 authorization. This is a usage-based estimate, not a balance audit. No credential is stored in this repository or in the sanitized reports. No additional UI interaction was claimed: installed-artifact activation and extension-host behavior were tested separately as described above.

## Official sources

Verified 18 October 2026:

- https://api-docs.deepseek.com/zh-cn/guides/search
- https://api-docs.deepseek.com/zh-cn/api/search
- https://api-docs.deepseek.com/zh-cn/api/fetch
- https://api-docs.deepseek.com/zh-cn/quick_start/pricing/

Search and Fetch currently cost CNY 5 per 1,000 successful requests with results; empty searches and failures are not charged. Account limits are separately 5 QPS for Search and Fetch, with additional per-domain Fetch limits. These request charges are not included in the extension’s model-token usage totals. See the live official documentation for current pricing and the separate billing transition for server-side tool calls.
