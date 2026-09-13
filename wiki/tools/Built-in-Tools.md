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

## Web tools

- `search_web`: uses the selected isolated headless search engine and returns up to ten normalized organic HTTPS URLs.
- `read_web`: reads only a URL registered to a search ID or explicitly supplied by the user, and returns bounded inert page sections.

The Web search toggle controls both definitions. When disabled, neither tool is sent to DeepSeek.

## Vision tool

- `analyze_images`: asks DeepSeek V4.1 Flash about one or more images attached to the current user message, because V4 Pro cannot read images itself. It is offered only to a Pro generation that carries at least one unexpired attachment, never to a Flash generation or to a turn without images. The delegated request names `deepseek-flash`, sends the DeepSeek file IDs instead of Base64 or local paths, disables thinking, and caps its own output at 8K tokens. The handler resolves the requested attachment IDs inside the current message, rejects expired files and files uploaded to a different API origin, and reports the delegated usage against Flash in the `vision_analysis` phase.

## Execution rules

Tools return structured results so DeepSeek can continue, the UI can render useful activity, and history can preserve completed work. Host-side schemas, workspace resolution, permission policy, and cancellation remain authoritative. Terminal and mutation sensitivity is classified by an independent DeepSeek review; there is no local danger analyzer.

[Back](INDEX.md)
