import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const uiRoot = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(uiRoot, '..');
const productionCsp = [
  "default-src 'none'",
  "connect-src {{CSP_SOURCE}}",
  "img-src {{CSP_SOURCE}} data:",
  "font-src {{CSP_SOURCE}}",
  "style-src {{CSP_SOURCE}} 'nonce-{{NONCE}}' 'unsafe-inline'",
  "script-src {{CSP_SOURCE}} 'nonce-{{NONCE}}'",
].join('; ');

export default defineConfig({
  root: uiRoot,
  plugins: [
    react(),
    {
      name: 'deepseek-production-csp',
      apply: 'build',
      transformIndexHtml(html) {
        return html.replace(
          /<meta name="viewport"/,
          `<meta http-equiv="Content-Security-Policy" content="${productionCsp}" />\n    <meta name="viewport"`,
        );
      },
    },
  ],
  base: './',
  server: {
    cors: true,
    hmr: {
      host: 'localhost',
      port: 5175,
      protocol: 'ws',
    },
  },
  resolve: {
    alias: {
      '@': srcRoot,
      '@webview': uiRoot,
    },
  },
  build: {
    outDir: '../../dist/webview',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "markdown",
              test: /node_modules\/(?:react-markdown|remark-gfm|rehype-sanitize|refractor|prismjs|micromark|mdast-util|hast-util|unified|remark-|rehype-|property-information|space-separated-tokens|comma-separated-tokens|decode-named-character-reference|character-entities|trim-lines|zwitch|vfile|unist-util|bail|devlop|html-url-attributes|parse-entities)/,
            },
          ],
        },
      },
    },
  },
});
