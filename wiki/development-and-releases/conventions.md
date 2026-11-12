[Back](2.INDEX.MD)

# Conventions

## Wiki structure and navigation

- The root `wiki/1.README.MD` introduces the documentation and `wiki/2.INDEX.MD` is its main index. Each section folder and decision group has its own `1.README.MD` introduction and `2.INDEX.MD` page list. Keep these names and their uppercase `.MD` extension exactly: their numeric prefixes place them first when files are sorted by name.
- Name all other wiki pages in lowercase kebab-case with a lowercase `.md` extension, for example `dependency-rules.md`.
- Link each section page from its section index. Section pages and introductions start and end with `[Back]` links to that index; section indexes link back to the parent index. The root index has no parent link.
- Keep decision records under `wiki/development-and-releases/decisions/`. Design decisions go in `design/` and development decisions in `develop/`; list each record in its group index. Name them with descriptive kebab-case filenames such as `layer-boundaries.md`, keep the ADR or DDR number in the page title, and organize each record into Context, Decision and Consequences. Link the canonical instructions from the record instead of duplicating them.
- When adding, moving, or renaming a page, update its indexes and incoming links and verify that local Markdown links resolve.
- Give each topic a home in the [repository map](../architecture/repository-structure.md#wiki-sections) and link to that page from related sections.

## Markdown documentation

- Keep technical content concise, with short lists and concrete paths.
- Write each paragraph and list item on one source line. Keep the blank lines that separate Markdown blocks and the line breaks required by code, tables and Mermaid diagrams.
- Avoid unnecessary visual styling.
- Use Mermaid flowcharts for decisions and sequence diagrams for exchanges between components. Place each diagram next to the steps it illustrates and update both when the flow changes.
- Update technical Markdown in the same commit as the affected code.

## Formatting

- Prettier formats TypeScript, TSX, CSS, JSON, YAML, scripts and the root configuration. Use two spaces, double quotes, semicolons, LF endings and 100 columns.
- Run `npm run format` before committing and `npm run format:check` to verify. CI rejects unformatted files; do not hand-format around Prettier or add a conflicting ESLint formatting rule.
- Keep Markdown outside Prettier so the one-paragraph-per-line rule remains readable in diffs.

## Code

- State intent through names, types, and structure. A source comment may explain a non-obvious reason or point to the canonical wiki section instead of repeating it: `// See wiki/<section>/<page>.md#<anchor>.` Do not restate code, duplicate a documented rule, or leave commented-out code. Keep the directives tooling requires: `eslint-disable*`, `@ts-expect-error`, `@vite-ignore`, coverage pragmas, and license banners.
- Keep aliases consistent with `tsconfig.json`.
- Use `src/contracts` for shared serializable messages.
- Avoid duplicated strings for public ids.
- Do not store secrets outside `SecretStorage`.
- Do not reintroduce Ollama.
- Source folders use `camelCase`.
- Source implementation files use `PascalCase`.
- Keep ecosystem-required exceptions unchanged: `index.ts` barrels, Astro route files such as `index.astro` and `[slug].astro`, package/config files, and generated output.
- Keep barrels at layer or feature boundaries. Internal modules use explicit imports so dependencies remain visible.
- Prefer domain folders over one-component folder chains.
- Preserve public tool IDs and persisted keys deliberately. Protocol-breaking changes increment `WEBVIEW_PROTOCOL_VERSION`; protocol 5 intentionally does not accept the removed separate attachment requests.
- A facade coordinates services; it does not retain context building, execution, persistence, and UI-event translation in one file.
- Organize code by cohesive responsibility and keep cross-module dependencies behind explicit contracts or ports. Compose implementations at the extension boundary; do not import another feature's private implementation as a shortcut.
- Aim for 3–5 directly contained implementation files per feature folder, 3–5 parameters per function or constructor, and 250–300 physical lines per file. These are review signals, not automatic rejection thresholds. Split when there is a meaningful responsibility boundary, not merely to satisfy a count. Avoid single-file folder chains, artificial indirection, and parameter objects that only hide unrelated arguments. Public callbacks, generated files, assets, tests, configuration, and cohesive data tables may warrant exceptions.
- Keep cyclomatic complexity at or below 15, with 10 as the working target. ESLint enforces `complexity` as an error. Existing violations are frozen in `eslint-suppressions.json`; do not add entries, and prune them when a function is split or rewritten. Prefer extraction, table-driven dispatch, or explicit state transitions over mechanically splitting a function to satisfy the counter.
- When touching an oversized file or crowded folder, consider a focused extraction that preserves behavior and public contracts. Record a reason in the change when exceeding a guideline is the clearer design; migrate existing code incrementally rather than requiring a repository-wide reshuffle.

## New features

Before implementing:

1. identify the responsible layer.
2. update contracts if it crosses webview/backend.
3. document settings if they are public.
4. add manual verification if it affects UX.
5. run format check, compile, lint, and build.

[Back](2.INDEX.MD)
