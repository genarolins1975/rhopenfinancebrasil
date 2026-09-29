import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** WCAG 2.2 AA automatizado: falha em qualquer violação séria ou crítica. */
export async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
  const describe = (list: typeof results.violations) => JSON.stringify(list.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => n.target) })), null, 1);
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const others = results.violations.filter((v) => v.impact !== "serious" && v.impact !== "critical");
  if (others.length) console.warn(`axe (${page.url()}): violações moderadas ou menores registradas: ${describe(others)}`);
  expect(serious, describe(serious)).toEqual([]);
}
