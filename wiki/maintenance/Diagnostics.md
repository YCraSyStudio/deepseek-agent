[Back](INDEX.md)

# Diagnostics

Use **YCraSy DeepSeek Agent: Show Diagnostics** from the Command Palette to inspect the managed output channel. Normal operation logs only warnings and errors. The in-memory buffer retains at most 500 entries and 256 KiB and is discarded when the extension host stops.

Diagnostics may contain timestamps, event categories, terminal status, and opaque request, conversation, generation, or tool-call correlation IDs. They do not intentionally contain prompts, reasoning, file contents, tool output, full filesystem paths, authorization values, API keys, secrets, or user identifiers. Values are centrally redacted before reaching the channel.

The command can copy a sanitized support report containing extension, VS Code, operating-system, model, permission-mode, and feature metadata. Use **YCraSy DeepSeek Agent: Clear Diagnostics** to clear all retained entries and the visible channel.

[Back](INDEX.md)
