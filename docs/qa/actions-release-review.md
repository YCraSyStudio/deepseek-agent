# Release and GitHub Actions review

## Observed failures

- [Initial 0.1.15 attempt](https://github.com/YCraSyStudio/deepseek-agent/actions/runs/34768457532): Knip rejected an unused documentation script, exports and a type. These findings were fixed before the [successful release run](https://github.com/YCraSyStudio/deepseek-agent/actions/runs/34786368625).
- [Pages deployment after 0.1.15](https://github.com/YCraSyStudio/deepseek-agent/actions/runs/34786368223): the legacy Pages builder used repository root as its source. Jekyll parsed `web-doc/src/**/*.astro` as YAML and failed with `Invalid YAML front matter`. The repository configuration still uses `main:/` and reports an errored site. Updating the source to `main:/docs` was rejected by GitHub with HTTP 403 (`Resource not accessible by integration`); a repository administrator must change this setting.
- [October 24 develop run](https://github.com/YCraSyStudio/deepseek-agent/actions/runs/40100937074): dependency audit rejected high-severity advisories in the Astro/Vite tree. The [October 26 run](https://github.com/YCraSyStudio/deepseek-agent/actions/runs/40341010325) passed quality, all three extension hosts and installed-VSIX smoke tests.

## Changes prepared

- Build and validate Astro documentation in Production gates before packaging and release publication. Keep existing code, audit and cross-platform checks enforced.
- Replace the Chromium manager's older archive/proxy dependency tree with `@puppeteer/browsers` 3.2.6 and explicit runtime proxy/ZIP support. Pin `get-uri`'s transitive `basic-ftp` to 6.2.3 in both package-manager configurations to eliminate its high-severity advisory without weakening audit thresholds.
- Document the required Pages source and `.nojekyll` configuration in the publishing guide.
