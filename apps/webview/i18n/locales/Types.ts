export interface TranslationCatalog {
  readonly [key: string]: string | TranslationCatalog;
}

export type TranslationKey<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends TranslationCatalog
      ? `${K}.${TranslationKey<T[K]>}`
      : never;
}[keyof T & string];

type UnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (value: infer I) => void ? I : never;

export function mergeCatalogSections<const T extends readonly TranslationCatalog[]>(...sections: T): UnionToIntersection<T[number]> {
  const catalog: Record<string, string | TranslationCatalog> = {};
  for (const section of sections) {
    for (const [key, value] of Object.entries(section)) {
      if (Object.prototype.hasOwnProperty.call(catalog, key)) {
        throw new Error(`Duplicate translation key: ${key}`);
      }
      catalog[key] = value;
    }
  }
  return catalog as UnionToIntersection<T[number]>;
}
