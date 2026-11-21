import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getDomain } from "tldts";

const DNS_TIMEOUT_MS = 4_000;

export interface ResolvedPublicAddress {
  address: string;
  family: 4 | 6;
}

export class WebAccessPolicy {
  private readonly grantedSites = new Set<string>();
  private readonly grantedUrls = new Set<string>();
  private readonly redirectSites = new Set<string>();
  private readonly providerRoutes = new Set<string>();

  grantProvider(url: string): void {
    const parsed = validatePublicWebUrl(url);
    this.grantedSites.add(registrableSite(parsed.hostname));
    this.grantedUrls.add(parsed.toString());
    this.providerRoutes.add(providerRouteKey(parsed));
  }

  grantResult(url: string): void {
    const parsed = validatePublicWebUrl(url);
    this.grantedUrls.add(parsed.toString());
    const site = registrableSite(parsed.hostname);
    this.grantedSites.add(site);
    this.redirectSites.add(site);
  }

  grantSubresource(url: string): void {
    const parsed = validatePublicWebUrl(url);
    this.grantedSites.add(registrableSite(parsed.hostname));
  }

  grantUserUrls(urls: readonly string[]): void {
    for (const value of urls) {
      try { this.grantResult(value); } catch { }
    }
  }

  isAllowedHostname(hostname: string): boolean {
    if (isIP(stripBrackets(hostname)) !== 0) {return false;}
    return this.grantedSites.has(registrableSite(hostname));
  }

  assertNavigationAllowed(value: string): URL {
    const url = validatePublicWebUrl(value);
    const site = registrableSite(url.hostname);
    const providerPathAllowed = this.providerRoutes.has(providerRouteKey(url));
    if (!this.grantedUrls.has(url.toString()) && !this.redirectSites.has(site) && !providerPathAllowed) {
      throw new Error("URL is not authorized for this web session");
    }
    return url;
  }
}

export function extractHttpsUrls(text: string): string[] {
  const urls: string[] = [];
  for (const match of text.matchAll(/https:\/\/[^\s<>"'`]+/gi)) {
    const raw = match[0].replace(/[),.;!?]+$/, "");
    try { urls.push(validatePublicWebUrl(raw).toString()); } catch { }
  }
  return [...new Set(urls)];
}

export function validatePublicWebUrl(value: string): URL {
  if (!value || value.length > 4_096) {throw new Error("Invalid web URL");}
  let url: URL;
  try {url = new URL(value);} catch {throw new Error("URL must be absolute HTTPS");}
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Only credential-free HTTPS URLs are allowed");
  }
  if (url.port && url.port !== "443") {throw new Error("Only HTTPS port 443 is allowed");}
  if (isIP(stripBrackets(url.hostname)) !== 0 || isForbiddenHostname(url.hostname)) {
    throw new Error("IP literals and local hostnames are not allowed");
  }
  return url;
}

export async function resolvePublicHostname(
  hostname: string,
  resolver: (value: string) => Promise<Array<{ address: string; family: number }>> =
    (value) => lookup(value, { all: true, verbatim: true }),
): Promise<ResolvedPublicAddress[]> {
  if (isForbiddenHostname(hostname) || isIP(stripBrackets(hostname)) !== 0) {
    throw new Error("Local or literal-IP destinations are blocked");
  }
  let timeout: NodeJS.Timeout | undefined;
  const result = await Promise.race([
    resolver(hostname),
    new Promise<never>((_, reject) => {timeout = setTimeout(() => reject(new Error("DNS lookup timed out")), DNS_TIMEOUT_MS);}),
  ]).finally(() => {if (timeout) {clearTimeout(timeout);}});
  if (result.length === 0) {throw new Error("DNS lookup returned no addresses");}
  const addresses = result.map((entry) => ({ address: entry.address, family: entry.family as 4 | 6 }));
  if (addresses.some((entry) => !isPublicIp(entry.address))) {
    throw new Error("DNS resolution contains a non-public address");
  }
  return addresses;
}

export function isPublicIp(value: string): boolean {
  const family = isIP(value);
  if (family === 4) {
    const parts = value.split(".").map(Number);
    const [a, b] = parts;
    return !(a === 0 || a === 10 || a === 127 || a! >= 224 ||
      (a === 100 && b! >= 64 && b! <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 192 && b === 88 && parts[2] === 99) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && parts[2] === 100) ||
      (a === 203 && b === 0 && parts[2] === 113));
  }
  if (family !== 6) {return false;}
  const normalized = value.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    return isPublicIp(normalized.slice(7));
  }
  const address = ipv6ToBigInt(normalized);
  if (address === undefined) {return false;}
  return inIpv6Cidr(address, "2000", 3) &&
    !inIpv6Cidr(address, "2001", 23) &&
    !inIpv6Cidr(address, "20010db8", 32) &&
    !inIpv6Cidr(address, "2002", 16) &&
    !inIpv6Cidr(address, "3fff", 20);
}

export function registrableSite(hostname: string): string {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return getDomain(normalized, { allowPrivateDomains: true }) ?? normalized;
}

function isForbiddenHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "localhost" || normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") || normalized.endsWith(".internal") ||
    normalized === "metadata.google.internal";
}

function stripBrackets(value: string): string {
  return value.replace(/^\[|\]$/g, "");
}

function providerRouteKey(url: URL): string {
  return `${url.hostname.toLowerCase()}:${url.port || "443"}${url.pathname}`;
}

function ipv6ToBigInt(value: string): bigint | undefined {
  const sides = value.split("::");
  if (sides.length > 2) {return undefined;}
  const left = sides[0] ? sides[0].split(":") : [];
  const right = sides[1] ? sides[1].split(":") : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {return undefined;}
  return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n);
}

function inIpv6Cidr(address: bigint, prefixHex: string, bits: number): boolean {
  const prefix = BigInt(`0x${prefixHex}`) << BigInt(128 - prefixHex.length * 4);
  const shift = BigInt(128 - bits);
  return address >> shift === prefix >> shift;
}
