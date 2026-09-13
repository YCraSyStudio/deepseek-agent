import { changelog as enChangelog } from "./en/Changelog";
import { intro as enIntro } from "./en/Intro";
import { overview as enOverview } from "./en/Overview";
import { references as enReferences } from "./en/References";
import { technicalDecisions as enTechnicalDecisions } from "./en/TechnicalDecisions";
import { userManual as enUserManual } from "./en/UserManual";
import { changelog as esChangelog } from "./es/Changelog";
import { intro as esIntro } from "./es/Intro";
import { overview as esOverview } from "./es/Overview";
import { references as esReferences } from "./es/References";
import { technicalDecisions as esTechnicalDecisions } from "./es/TechnicalDecisions";
import { userManual as esUserManual } from "./es/UserManual";
import type { OverviewContent, PageContent, PageSlug } from "./Types";
import { changelog as zhChangelog } from "./zh/Changelog";
import { intro as zhIntro } from "./zh/Intro";
import { overview as zhOverview } from "./zh/Overview";
import { references as zhReferences } from "./zh/References";
import { technicalDecisions as zhTechnicalDecisions } from "./zh/TechnicalDecisions";
import { userManual as zhUserManual } from "./zh/UserManual";

export const languages = ["en", "es", "zh"] as const;

export type Language = (typeof languages)[number];
export type { OverviewContent, PageContent, PageSlug };

export const languageLabels: Record<Language, string> = {
  en: "English",
  es: "Español",
  zh: "中文",
};

export const pageSlugs = ["intro", "changelog", "references", "technical-decisions", "user-manual"] as const satisfies readonly PageSlug[];

export const homeContent: Record<Language, OverviewContent> = {
  en: enOverview,
  es: esOverview,
  zh: zhOverview,
};

export const pageContent: Record<Language, Record<PageSlug, PageContent>> = {
  en: {
    intro: enIntro,
    changelog: enChangelog,
    references: enReferences,
    "technical-decisions": enTechnicalDecisions,
    "user-manual": enUserManual,
  },
  es: {
    intro: esIntro,
    changelog: esChangelog,
    references: esReferences,
    "technical-decisions": esTechnicalDecisions,
    "user-manual": esUserManual,
  },
  zh: {
    intro: zhIntro,
    changelog: zhChangelog,
    references: zhReferences,
    "technical-decisions": zhTechnicalDecisions,
    "user-manual": zhUserManual,
  },
};

export const navLabels: Record<Language, Record<PageSlug, string>> = Object.fromEntries(
  languages.map((lang) => [
    lang,
    Object.fromEntries(pageSlugs.map((slug) => [slug, pageContent[lang][slug].navTitle])) as Record<PageSlug, string>,
  ]),
) as Record<Language, Record<PageSlug, string>>;

export function isLanguage(value: string | undefined): value is Language {
  return languages.includes(value as Language);
}

function sitePath(path = ""): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const normalizedPath = path.replace(/^\//, "");
  return normalizedPath ? `${base}/${normalizedPath}` : `${base}/`;
}

function docsPath(lang: Language, slug?: PageSlug): string {
  return sitePath(slug ? `${lang}/${slug}/` : `${lang}/`);
}

function englishPath(slug?: PageSlug): string {
  return sitePath(slug ? `${slug}/` : "");
}

export function canonicalPath(lang: Language, slug?: PageSlug): string {
  return lang === "en" ? englishPath(slug) : docsPath(lang, slug);
}

export type AlternateLanguage = Language | "x-default";

export function alternateEntries(slug?: PageSlug): { lang: AlternateLanguage; path: string }[] {
  return [
    { lang: "en", path: englishPath(slug) },
    { lang: "es", path: docsPath("es", slug) },
    { lang: "zh", path: docsPath("zh", slug) },
    { lang: "x-default", path: englishPath(slug) },
  ];
}

function anchorId(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function sectionAnchor(title: string): string {
  const version = /^(\d+)\.(\d+)\.(\d+)/.exec(title);
  return version ? `v${version[1]}-${version[2]}-${version[3]}` : anchorId(title);
}
