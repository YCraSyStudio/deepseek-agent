import type { APIRoute } from "astro";
import { alternateEntries, canonicalPath, languages, pageSlugs, type PageSlug } from "../i18n";

export const prerender = true;

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const GET: APIRoute = ({ site }) => {
  const siteRoot = new URL(canonicalPath("en"), site ?? "https://ycrasystudio.github.io/");
  const absoluteUrl = (path: string) => new URL(path, siteRoot).href;
  const lastmod = new Date().toISOString();
  const slugs: (PageSlug | undefined)[] = [undefined, ...pageSlugs];

  const entries = slugs.flatMap((slug) =>
    languages.map((lang) => ({
      loc: escapeXml(absoluteUrl(canonicalPath(lang, slug))),
      alternates: alternateEntries(slug).map((entry) => ({
        lang: entry.lang,
        href: escapeXml(absoluteUrl(entry.path)),
      })),
    })),
  );

  const urls = entries
    .map((entry) =>
      [
        "  <url>",
        `    <loc>${entry.loc}</loc>`,
        `    <lastmod>${lastmod}</lastmod>`,
        ...entry.alternates.map(
          (alternate) =>
            `    <xhtml:link rel="alternate" hreflang="${alternate.lang}" href="${alternate.href}" />`,
        ),
        "  </url>",
      ].join("\n"),
    )
    .join("\n");

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    urls,
    "</urlset>",
    "",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
