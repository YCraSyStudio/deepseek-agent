import { en } from "./en";
import { es } from "./es";
import { zh } from "./zh";
import type { TranslationCatalog } from "./Types";

export const localeCatalogs: Record<"en" | "es" | "zh", TranslationCatalog> = { en, es, zh };
