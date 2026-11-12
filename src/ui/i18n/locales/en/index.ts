import { common } from "./common";
import { settings } from "./settings";
import { tools } from "./tools";
import { history } from "./history";
import { chat } from "./chat";
import { confirmations } from "./confirmations";
import { results } from "./results";
import { mergeCatalogSections } from "../Types";

export const en = mergeCatalogSections(
  common,
  settings,
  tools,
  history,
  chat,
  confirmations,
  results,
);
