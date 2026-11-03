import assert from "node:assert/strict";
import { createElement } from "react";
import SettingsView from "@/ui/views/settingsView/SettingsView";
import { setInterfaceLanguage, t } from "@/ui/i18n";
import { createDomHarness } from "../../../support/DomHarness";

suite("settings without a VS Code host", () => {
  test("shows an unavailable error and keeps destructive reset disabled", async () => {
    const h = await createDomHarness(); setInterfaceLanguage("en");
    Reflect.deleteProperty(h.dom.window, "acquireVsCodeApi");
    try {
      await h.render(createElement(SettingsView)); assert.match(h.query('[role="alert"]').textContent!, new RegExp(t("settings.unavailable")));
      const reset = [...h.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === t("settings.reset.label")); assert.ok(reset?.disabled);
      await h.click(".settingsError button"); assert.deepEqual(h.posts, []);
    } finally { await h.dispose(); }
  });
});
