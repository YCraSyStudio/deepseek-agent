import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://ycrasystudio.github.io",
  base: "/deepseek-agent",
  output: "static",
  outDir: "../docs",
  vite: {
    build: {
      emptyOutDir: false,
      assetsInlineLimit: 0,
    },
  },
});
