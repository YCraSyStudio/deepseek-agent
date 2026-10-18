export interface SearchLocale {
  language: string;
  region?: string;
  tag: string;
}

export function resolveSearchLocale(
  languageArgument: string | undefined,
  regionArgument: string | undefined,
  systemLocale: string | undefined,
  vscodeLanguage: string | undefined,
): SearchLocale {
  const base = parseLocale(languageArgument ?? systemLocale ?? vscodeLanguage ?? "en");
  const region = regionArgument ?? base.region;
  return { language: base.language, region, tag: region ? `${base.language}-${region}` : base.language };
}

export function addDomainConstraint(query: string, domains: readonly string[]): string {
  if (domains.length === 0) {return query;}
  if (domains.length === 1) {return `${query} site:${domains[0]}`;}
  return `${query} ${domains.map((domain) => `site:${domain}`).join(" OR ")}`;
}

function parseLocale(locale: string): { language: string; region?: string } {
  const parts = locale.replace(/_/g, "-").split("-").filter(Boolean);
  const language = /^[a-z]{2,3}$/i.test(parts[0] ?? "") ? parts[0]!.toLowerCase() : "en";
  const region = parts.find((part, index) => index > 0 && /^(?:[a-z]{2}|\d{3})$/i.test(part))?.toUpperCase();
  return { language, region };
}
