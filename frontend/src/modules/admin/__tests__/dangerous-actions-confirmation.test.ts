import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("dangerous CRM actions confirmations", () => {
  it("uses ConfirmModal instead of native dialogs in priority admin surfaces", () => {
    const files = [
      "src/modules/admin/AdminTabUsers.tsx",
      "src/modules/admin/AdminTabTeams.tsx",
      "src/modules/admin/AdminTabAgencies.tsx",
      "src/modules/admin/AdminTabOrg.tsx",
      "src/pages/admin/AdminOrganizationsPage.tsx",
      "src/contexts/OrganizationContext.tsx",
    ];

    for (const file of files) {
      const source = read(file);
      expect(source, file).not.toMatch(/window\.alert|window\.confirm|\bconfirm\(/);
    }
  });

  it("keeps modal confirmations on destructive or sensitive admin actions", () => {
    expect(read("src/modules/admin/AdminTabUsers.tsx")).toContain("impersonateConfirmUser");
    expect(read("src/modules/admin/AdminTabUsers.tsx")).toContain("deleteConfirmUser");
    expect(read("src/modules/admin/AdminTabTeams.tsx")).toContain("deleteConfirmTeam");
    expect(read("src/modules/admin/AdminTabAgencies.tsx")).toContain("deleteConfirmAgency");
    expect(read("src/modules/admin/AdminTabOrg.tsx")).toContain("deleteAssetTarget");
    expect(read("src/pages/admin/AdminOrganizationsPage.tsx")).toContain("pendingAction");
  });
});
