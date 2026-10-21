const MAX_QUERY_CHARS = 128;
const MAX_FOCUS_CHARS = 500;

export function validateSearchQuery(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || Array.from(value.trim()).length > MAX_QUERY_CHARS) {
    throw new Error(`query must contain between 1 and ${MAX_QUERY_CHARS} characters`);
  }
  return value.trim();
}

export function validateOpaqueId(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(value)) {
    throw new Error(`${name} must be an identifier returned by a previous web tool`);
  }
  return value;
}

export function validateOptionalFocus(value: unknown): string | undefined {
  if (value === undefined) {return undefined;}
  if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > MAX_FOCUS_CHARS) {
    throw new Error(`focus must contain between 1 and ${MAX_FOCUS_CHARS} characters`);
  }
  return value.trim();
}

export function validateResultLimit(value: unknown): number {
  if (value === undefined) {return 8;}
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 50) {
    throw new Error("max_results must be an integer between 1 and 50");
  }
  return value as number;
}

export function validateDomains(value: unknown): string[] {
  if (value === undefined) {return [];}
  if (!Array.isArray(value) || value.length > 5) {
    throw new Error("domains must contain at most five public domain names");
  }
  const domains = value.map((entry) => {
    if (typeof entry !== "string") {throw new Error("domains must contain domain names");}
    const domain = entry.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (domain.length === 0 || domain.length > 253 || domain.includes("/") ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain) ||
      isPrivateHostname(domain)) {
      throw new Error(`Invalid public domain: ${entry}`);
    }
    return domain;
  });
  return [...new Set(domains)];
}

export function validateLanguage(value: unknown): string | undefined {
  if (value === undefined) {return undefined;}
  if (typeof value !== "string" || !/^[A-Za-z]{2,3}(?:-[A-Za-z]{4})?(?:-[A-Za-z]{2}|-\d{3})?$/.test(value.trim())) {
    throw new Error("language must be a BCP-47 language tag such as es or es-ES");
  }
  return value.trim();
}

export function validateCursor(value: unknown): string | undefined {
  if (value === undefined) {return undefined;}
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new Error("cursor must be a cursor returned by read_web");
  }
  return value;
}

function isPrivateHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    return true;
  }
  if (hostname.includes(":")) {return true;}

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!ipv4) {return false;}
  const octets = ipv4.slice(1).map(Number);
  if (octets.some((part) => part > 255)) {return true;}
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 ||
    (first === 100 && second! >= 64 && second! <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second! >= 16 && second! <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first! >= 224;
}
