[Back](INDEX.md)

# Conventions

## Markdown documentation

- Concise technical content.
- No unnecessary visual styling.
- `wiki/README.md` is the introduction; `wiki/INDEX.md` is the full documentation index.
- Every documentation folder keeps its introduction in `README.md` and its page list in `INDEX.md`.
- Every documentation page starts and ends with `[Back]` to its local `INDEX.md`; each section index does the same for the parent `INDEX.md`.
- Prefer short lists and concrete paths.
- Update technical Markdown in the same commit as the affected code.

## Code

- Source files carry no comments. State intent through names, types, and
  structure. Keep only the directives tooling requires: `eslint-disable*`,
  `@ts-expect-error`, `@vite-ignore`, coverage pragmas, and license banners.
- Keep aliases consistent with `tsconfig.json`.
- Use `src/contracts` for shared serializable messages.
- Avoid duplicated strings for public ids.
- Do not store secrets outside `SecretStorage`.
- Do not reintroduce Ollama.
- Source folders use `camelCase`.
- Source implementation files use `PascalCase`.
- Keep ecosystem-required exceptions unchanged: `index.ts` barrels, Astro route files such as `index.astro` and `[slug].astro`, package/config files, and generated output.
- Keep barrels at layer or feature boundaries. Internal modules use explicit
  imports so dependencies remain visible.
- Prefer domain folders over one-component folder chains.
- Preserve public tool IDs and persisted keys deliberately. Protocol-breaking changes increment `WEBVIEW_PROTOCOL_VERSION`; protocol 5 intentionally does not accept the removed separate attachment requests.
- A facade coordinates services; it does not retain context building, execution,
  persistence, and UI-event translation in one file.

## New features

Before implementing:

1. identify the responsible layer.
2. update contracts if it crosses webview/backend.
3. document settings if they are public.
4. add manual verification if it affects UX.
5. run compile, lint, and build.

[Back](INDEX.md)
