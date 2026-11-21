import { useContext } from "react";
import type { VsCodeApi } from "@webview/VsCodeApi";
import { VsCodeContext } from "./VsCodeContext";

export function useVsCode(): VsCodeApi | null {
  return useContext(VsCodeContext);
}
