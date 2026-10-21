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
  const region = regionArgument === "global" ? undefined
    : regionArgument ?? base.region ?? parseLocale(systemLocale ?? "en").region;
  return { language: base.language, region, tag: region ? `${base.language}-${region}` : base.language };
}

export function resolveSearchRegion(value: unknown, systemLocale: string | undefined): string | undefined {
  if (value === "global") {return undefined;}
  if (value === undefined || value === "auto") {return parseLocale(systemLocale ?? "en").region;}
  if (typeof value !== "string" || !/^[A-Za-z]{2}$/.test(value)) {
    throw new Error("region must be a two-letter country code or global");
  }
  return value.toUpperCase();
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
