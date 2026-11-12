[Back](2.INDEX.MD)

# Editor Assistance

## Prerequisites

Editor and chat assistance require a trusted workspace and a configured API key. Automatic suggestions also require **Settings → API → Beta features** and their individual toggle. The beta switch does not change the provider or API origin.

| Feature | Beta switch | Individual toggle | Trigger |
| --- | --- | --- | --- |
| Inline editor completion | Required | `editorSuggestionsEnabled` | Automatic while typing, or explicit editor suggestion. |
| Chat draft suggestion | Required | `chatSuggestionsEnabled` | Manual button in the composer footer. |
| Complete command | Required | None | `YCraSy DeepSeek Agent: Complete`. |
| Refactor command | Not required | None | `YCraSy DeepSeek Agent: Refactor`. |

## Inline editor completions

`CompletionService` sends a FIM request for the active editor:

- only `file`, `untitled` and `vscode-remote` documents are eligible;
- the cursor must be a collapsed selection in the active editor, and that editor must still own the document;
- an automatic request waits 700 ms, so continued typing cancels it before a call is made;
- an explicit invocation skips that delay;
- at most 12,000 characters of prefix and 4,000 of suffix are sent;
- output is capped at 256 tokens with a 10-second deadline;
- the continuation is discarded if the document version, active editor, cursor or settings revision changed while it was generated.

Suggestions are cached by source, prefix, suffix, settings revision, origin, model and project context. The cache keeps 20 entries. A failed request starts a 15-second cooldown for that source instead of retrying on every keystroke. Disabling the setting, changing the model or changing beta mode invalidates pending work and the cache.

## Chat draft suggestions

The composer footer shows a sparkle action only when chat suggestions are enabled. It is a manual request, not an automatic completion on every keystroke:

- the draft must be at most 12,000 characters, focused and at the end; path autocomplete and IME composition block it;
- the request carries the current draft and up to 6,000 characters of project metadata;
- the model returns at most 96 tokens, stops at a blank line, and the UI keeps at most 400 characters;
- the result is appended only if the draft, focus, cursor and request still match; otherwise it is discarded;
- if the model returns nothing, the composer reports that a suggestion is unavailable;
- editing, changing context, losing focus or changing settings cancels the request.

Project metadata is background context, never instructions. The prompt explicitly forbids inventing bugs, tasks, requirements or personal information.

## Complete and Refactor

Both commands operate on the active editor's resolved target and show a native diff before writing:

1. `resolveEditorTarget` selects the current selection or the surrounding block.
2. The request includes the target, its language, and bounded before/after context; those sections are declared read-only data.
3. The replacement must finish with `stop` and stay under 128,000 characters, otherwise the command reports a truncated or oversized result.
4. A `ycrasy-edit-preview` diff opens with the proposed change.
5. **Apply** writes the replacement with undo stops; **Discard**, Escape or closing the diff leaves the document untouched.
6. The document version is checked again before applying. A concurrent edit aborts the operation.

Complete is a beta prefix-completion request. Refactor is an ordinary chat request and does not require beta features. Both disable thinking and have a 45-second deadline. Neither runs while the workspace is untrusted.

## Related

- [Commands and views](commands-and-views.md)
- [Settings reference](../settings-and-data/settings-reference.md)
- [Message contract](message-contract.md)
- [Built-in tools](../tools-and-permissions/built-in-tools.md#beta-code-completion)

[Back](2.INDEX.MD)
