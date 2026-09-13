# YCraSy DeepSeek Agent Web Doc

Human-facing visual documentation for YCraSy DeepSeek Agent, built with Astro.

## Languages

The site supports:

- English: `/deepseek-agent/en/`
- Spanish: `/deepseek-agent/es/`
- Chinese: `/deepseek-agent/zh/`

Translated content lives in `src/i18n/[lang]/[page].ts`.

Shared i18n types, route helpers, and composition live in `src/i18n/index.ts`.

## Scripts

- `npm run dev`: local Astro server.
- `npm run build`: validation and static build into the repository root `docs/` folder.
- `npm run preview`: build preview using Astro's configured base path.
- `npm run lint`: Astro validation.

## GitHub Pages

Astro writes the static site to `../docs` so GitHub Pages can serve it from the repository root `/docs` folder.

The production base path is `/deepseek-agent`, matching the project page URL:

https://ycrasystudio.github.io/deepseek-agent/

Technical documentation lives in the GitHub Wiki:

https://github.com/YCraSyStudio/deepseek-agent/wiki
