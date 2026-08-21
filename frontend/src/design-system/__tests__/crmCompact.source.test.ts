import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), "frontend");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("crm compact source audit", () => {
  it("active le compactage CRM depuis AppLayout en excluant Mail, DP/Documents et Calpinage", () => {
    const layout = read("src/layout/AppLayout.tsx");
    expect(layout).toContain("sn-main--compact-crm");
    expect(layout).toContain('pathname === "/mail"');
    expect(layout).toContain('pathname.startsWith("/mail/")');
    expect(layout).toContain('pathname === "/settings/mail"');
    expect(layout).toContain('pathname === "/documents"');
    expect(layout).toContain("/dp");
    expect(layout).toContain("/calpinage");
  });

  it("charge la couche compacte apres les styles CRM de base", () => {
    const main = read("src/main.tsx");
    expect(main).toContain('import "./design-system/crm-compact.css";');
    expect(main.indexOf('import "./design-system/sidebar-crm.css";')).toBeLessThan(
      main.indexOf('import "./design-system/crm-compact.css";'),
    );
  });

  it("reduit les dimensions principales autour de 20 pourcent sans transform visuel", () => {
    const css = read("src/design-system/crm-compact.css");
    expect(css).toContain(".sn-main--compact-crm");
    expect(css).toContain("--sn-crm-compact-scope: 1");
    expect(css).toContain("--spacing-32: 26px");
    expect(css).toContain("--spacing-24: 19px");
    expect(css).toContain("--sn-ui-control-h-md: 26px");
    expect(css).toContain("--sn-ui-table-row-min-h: 36px");
    expect(css).not.toContain("transform: scale");
  });
});
