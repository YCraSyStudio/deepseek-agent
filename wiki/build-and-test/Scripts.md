[Back](INDEX.md)

# Scripts

## Root

- `pnpm run compile`: TypeScript without emitting files.
- `pnpm run watch`: TypeScript in watch mode.
- `pnpm run build`: extension + webview.
- `pnpm run build:extension`: bundle `dist/extension.js`.
- `pnpm run build:webview`: bundle `dist/webview`.
- `pnpm run dev:webview`: Vite server for UI.
- `pnpm run lint`: ESLint over `src`.
- `pnpm run test:unit`: recursively discovers unit tests under `src/test` while
  excluding `src/test/integration`.
- `pnpm run test:integration`: builds and runs the VS Code Extension Development
  Host tests from `src/test/integration`.
- `pnpm test`: unit tests followed by integration tests.

## Web documentation

In `web-doc`:

- `pnpm run dev`: Astro dev server.
- `pnpm run build`: Astro build.
- `pnpm run preview`: preview the build.

## Local Node

If the environment uses `nvm`, load it first:

```bash
source ~/.nvm/nvm.sh
```

[Back](INDEX.md)
