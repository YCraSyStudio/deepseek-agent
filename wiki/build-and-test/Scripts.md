[Back](INDEX.md)

# Scripts

## Root

Use Node 26 LTS locally and npm 12.2.1. CI currently uses Node 24. Run `npm ci` at the repository root to install the extension and web documentation from package-lock.json.

- `npm run compile`: TypeScript without emitting files.
- `npm run watch`: TypeScript in watch mode.
- `npm run build`: extension + webview.
- `npm run build:extension`: bundle `dist/extension.js`.
- `npm run build:webview`: bundle `dist/webview`.
- `npm run dev:webview`: Vite server for UI.
- `npm run lint`: ESLint over `src`.
- `npm run test:unit`: recursively discovers unit tests under `src/test` while
  excluding `src/test/integration`.
- `npm run test:integration`: builds and runs the VS Code Extension Development
  Host tests from `src/test/integration`.
- `npm test`: unit tests followed by integration tests.

- `npm run test:coverage:full`: combined unit and VS Code integration coverage.
- `npm run test:coverage:check`: optional strict 100% diagnostic; not the essential-regression acceptance gate.
- `npm run package:vsix`: build the release package under `artifacts/`.
- `npm run verify:vsix`: verify package contents and release-channel metadata.

Coverage reports remain outside the VSIX. See [regression coverage](REGRESSION_COVERAGE.md) for the agreed scope and verified results.

## Web documentation

In `web-doc`:

- `npm run dev`: Astro dev server.
- `npm run build`: Astro build.
- `npm run preview`: preview the build.

## Local Node

If the environment uses `nvm`, load it first:

```bash
source ~/.nvm/nvm.sh
nvm use 26
```

[Back](INDEX.md)
