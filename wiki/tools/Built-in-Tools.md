[Back](INDEX.md)

# Built-in Tools

## Workspace tools

- `read_file`: reads bounded workspace content, or only the lines of an `offset`/`limit` range. A whole-file read is the last resort of the reading order the system prompt and both read tools state: `read_func` for a named declaration, `search_content` plus a range for what the editor cannot name, and context that spans declarations for the whole file. The range form locates the name with `search_content`, so its lines are read without the rest of the file. A range answers `startLine`, `endLine`, `totalLines`, and `hasMore`, keeps the whole-file SHA-256 so a later edit can guard its revision, returns at most 600 lines or 48 KiB, and refuses a file over 8 MiB.
- `read_func`: the preferred read whenever a declaration is the target. Reads only the named functions, methods, or types of one source file. A name may be chained through its enclosing declaration (`ToolCallCycle.run`, `outer.inner`, `Repo.Save`), several names travel in one call, and `["*"]` selects every top-level declaration. Each match returns its exact source, its line range, its signature, and the file SHA-256, so a later edit can guard against a changed revision; an ambiguous bare name is answered with its qualified candidates instead of a guess, and an unknown name with the available symbol list. `mode: "outline"` reports structure without bodies, including the direct members of a class, interface, struct, or `impl` block. Symbols come from the editor's language providers, so every file type the editor can outline works, including TypeScript, JavaScript, Java, C#, C/C++, Kotlin, Swift, Scala, Dart, PHP, Go, Rust, and Python. Module-level `const` bindings resolve as well, and an empty provider answer is re-asked across a short backoff after the file has been loaded, because an activating language service reports no symbols at first; members of an object literal are not declarations and so are not reported, which is the one shape a chained name cannot reach; binary files and files larger than 4 MiB are refused, and a file whose language has no symbol provider is answered with a hint to locate the name with `search_content` and read its lines through a `read_file` range.
- `list_directory`: lists a workspace directory.
- `list_workspace`: renders the whole project as one indented tree in a single call, so a new chat does not have to chain `list_directory` calls. Hidden entries are included and a folder that holds too much content is summarized as `...` instead of being dumped or silently excluded; it reads at most 300 folders and stops after 400 entries or 48 KiB. A folder is summarized instead of listed when it holds more than 25 entries (60 at the workspace root) or when its subtree does not fit the remaining line budget.
- `search_content`: searches literal text case-insensitively without invoking a shell or interpreting regular expressions.
- `create_file`: creates or overwrites a file after permission and stale-content checks.
- `edit_file`: applies structured edits with optimistic SHA-256 guards.
- `apply_patch`: applies a patch while preserving workspace containment.
- `run_terminal_command`: runs a finite, non-interactive command visibly in a dedicated VS Code integrated terminal and reuses that same terminal for later commands so its scrollback/history stays visible. Shell Integration provides structured bounded output, exit status, timeout handling, and cancellation; non-VS Code hosts retain the headless executor as a compatibility fallback. The terminal is closed only on timeout, cancellation, a working-directory mismatch, or extension shutdown — never after a successful command.

Detached/background launchers are rejected because they can outlive the owned terminal and keep project files locked. Agent terminals disable .NET MSBuild server reuse and shared compilation so completed builds do not leave orphaned `dotnet` workers behind.

`search_content` accepts a non-empty query up to 4,096 characters and an optional workspace-relative glob up to 1,024 characters. It skips sensitive paths, binary files, and files over 2 MiB; scans at most 10,000 files; returns at most 50 matches; and times out after 15 seconds.

## Context tool

- `compact_context`: requests a tool-cycle context compaction. Its handler is a read-only no-op; the active tool protocol is rolled over into a compacted continuation at the next round. The model is expected to trust prior successful tool outcomes and not repeat completed mutations.

## Beta code completion

`complete_code` is offered only when `betaFeaturesEnabled` is enabled in Settings → General. `mode: prefix` continues an assistant prefix through `/beta/chat/completions`; `mode: fim` fills between code `prefix` and optional `suffix` through `/beta/completions`. Prefix mode also accepts a task `instruction` and a caller-supplied `reasoning_prefix` when thinking is enabled. A suffix is FIM-only; chat instructions and reasoning prefixes are prefix-only. Optional `stop` accepts up to 16 non-empty sequences. Output defaults to 1,024 tokens and never exceeds 4,096 or the configured lower output limit. Calls have a 60-second deadline, support cancellation and are not automatically retried. Results contain API response text and do not modify files; normal mutation tools retain their permission checks. Usage is tracked under `code_completion`.

The beta switch also enables strict schemas for function calls, with all object properties required, closed objects, and supported schema keywords. Optional values use a nullable enum branch and are omitted before host validation/execution when returned as null. Original host schemas and their validation remain intact. Disabling beta removes the completion tool from later rounds, blocks new completion calls, strips `strict`, and selects the stable chat endpoint. Existing requests may finish; enabling the setting exposes the completion tool to new generations. This does not enable another provider or change the stored API origin.

Official references: [Chat Prefix Completion](https://api-docs.deepseek.com/guides/chat_prefix_completion), [FIM Completion](https://api-docs.deepseek.com/guides/fim_completion), [Strict tool calls](https://api-docs.deepseek.com/guides/tool_calls#strict-mode-beta), and [FIM API](https://api-docs.deepseek.com/api/create-completion). The beta `reasoning_content` input is part of Chat Prefix Completion, rather than an independent feature. Normal thinking-mode reasoning history is still supported when beta is off.

## Web tools

- `search_web`: calls DeepSeek Search (`POST /v1/tools/search`), requests eight results by default (up to 50 on demand), and returns public HTTPS URLs with bounded summaries and available relevance, authority, date and site metadata. The query plus operators must fit 128 Unicode characters. Technical guidance favors version-matched official documentation, upstream repositories and issue discussions. Language is restricted only when explicitly requested.
- `read_web`: reads a URL registered to the current generation’s search or explicitly supplied by the user, returning bounded Markdown sections as untrusted data. It reuses content returned by Search (`need_content: true` by default) or already read in that generation. DeepSeek Fetch (`POST /v1/tools/fetch`) is used only when retained content is absent. `need_content: false` supports discovery-only searches.

`webSearchRegion` defaults to `global`. Selecting `auto` reads the local system locale's country code, not the user's physical location. Remote extension hosts do not use their server locale as the user's region. `global` disables regional preference; a two-letter country code selects another preference. A per-search `region` overrides the setting. The preference is natural-language context in the bounded `ori_question` field; it is a soft hint, not guaranteed geographic ranking. Search never discovers the public IP or sends a `localization` IP address. The API provider still observes the connection's source IP. Useful English technical sources remain available, and no country-specific domain filter is added automatically.

The Web search toggle controls both definitions. When disabled, neither tool is sent to DeepSeek.

## Vision tool

- `analyze_images`: asks DeepSeek V4.1 Flash about stored conversation images or confined workspace files. Flash reads current and retained visual attachments directly; numbered references do not require a tool call when their images are already in the visual context. Flash uses the tool for new captures or stored images no longer in context. Pro uses it to delegate all visual analysis, including current attachments. The tool remains available on both models without new attachments. Source references are recorded in the tool result and delegated usage is tracked in the `vision_analysis` phase.

## Execution rules

Tools return structured results so DeepSeek can continue, the UI can render useful activity, and history can preserve completed work. Host-side schemas, workspace resolution, permission policy, and cancellation remain authoritative. Terminal and mutation sensitivity is classified by an independent DeepSeek review; there is no local danger analyzer.

[Back](INDEX.md)

## Image analysis from local sources

`analyze_images({question, image_ids?, screenshot_ids?, paths?})` accepts attachment ids, screenshot ids (or `latest`), and workspace-relative JPEG/PNG/GIF/WebP files. When local sources are specified, attachment images are included only when their ids are specified. At most 8 images / 32 MiB per call and 16 MiB per local image. Sensitive paths, symlink escapes and files outside the workspace are rejected even in full-access mode.

Calling the tool explicitly uploads the selected images to DeepSeek V4.1 Flash and returns text, including the sent source references for the timeline. Local captures alone never upload data. Temporary uploads are cached by SHA-256 within the generation, expire after one hour and are deleted when the generation settles or is cancelled. User-owned attachments keep their existing lifecycle.

Conversation image references use the stable number shown on each sent thumbnail. For example, mention images 1 and 3 while attaching a new image 4; the agent can compare all three through screenshot_ids ["1", "3", "4"]. These numbers belong to the current conversation, survive reloads and are never reassigned after retention removes an image. Numbers are assigned when sending, and incognito images have no persistent number.
