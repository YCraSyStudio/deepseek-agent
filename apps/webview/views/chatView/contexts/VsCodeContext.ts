import { createContext } from "react";
import type { VsCodeApi } from "@webview/VsCodeApi";

export const VsCodeContext = createContext<VsCodeApi | null>(null);
