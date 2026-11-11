[Back](2.INDEX.MD)

# Registry and Executor

## `ToolRegistry`

Keeps available definitions:

- id.
- description.
- argument schema.
- safety metadata.
- logical handler.

## `ToolExecutor`

Responsibilities:

- resolve tool by id.
- validate arguments.
- check execution mode.
- run handler.
- return structured result.
- serialize non-read-only operations by workspace while allowing read-only tools to proceed concurrently.

## `ToolWorkspace`

Application port that separates `application` from VS Code. It exposes capabilities such as:

- read file.
- write file.
- list directory.
- search text.
- execute commands.
- open file.

The current VS Code implementation is `VsCodeToolWorkspace`.

`runWithToolWorkspaceHost` binds a validating host through `AsyncLocalStorage` for the lifetime of one generation. This keeps concurrent conversations pinned to their own workspace instead of racing on the process-wide default host.

The host represents the complete logical workspace. Multi-root paths begin with deterministic aliases, `list_directory(".")` exposes aliases as virtual directories, and content search can span every root. Parent traversal, absolute paths, URIs, and canonical symlink or junction escapes are rejected. Terminal commands use the root of the editor captured at generation start when `cwd` is omitted; they never fall back to the first root.

[Back](2.INDEX.MD)
