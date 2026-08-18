import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const calpinageRoot = resolve(here, "..");

function source(relativePath: string): string {
  return readFileSync(resolve(calpinageRoot, relativePath), "utf8");
}

describe("Phase 2 / Phase 3 explicit actions", () => {
  it("Phase2Sidebar does not trigger hidden DOM button clicks for roof validation", () => {
    const text = source("components/Phase2Sidebar.tsx");
    expect(text).not.toContain("document.getElementById");
    expect(text).not.toContain(".click()");
    expect(text).toContain("validateRoofSurveyAction");
  });

  it("Phase3Sidebar uses runtime actions for business commands instead of hidden DOM button clicks", () => {
    const text = source("components/Phase3Sidebar.tsx");
    expect(text).not.toContain("document.getElementById");
    expect(text).not.toContain("btn-validate-calpinage");
    expect(text).not.toContain("btn-back-roof");
    expect(text).not.toContain("pv-tool-autofill");
    expect(text).not.toContain("pv-autofill-confirm");
    expect(text).not.toContain("pv-autofill-cancel");
    expect(text).toContain("setPhase3ActiveTool");
    expect(text).toContain("runCalpinageAutofillPreview");
    expect(text).toContain("confirmCalpinageAutofill");
    expect(text).toContain("cancelCalpinageAutofill");
    expect(text).toContain("validateCalpinageAction");
    expect(text).toContain("requestBackToRoofAction");
  });
});
