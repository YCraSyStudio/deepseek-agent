export type PageSlug = "intro" | "changelog" | "references" | "technical-decisions" | "user-manual";

export type OverviewContent = {
  title: string;
  description: string;
  lead: string;
  cards: Record<PageSlug, string>;
};

type SectionContent = {
  title: string;
  items: string[];
};

export type PageContent = {
  navTitle: string;
  title: string;
  seoTitle: string;
  description: string;
  lead: string;
  sections: SectionContent[];
};
