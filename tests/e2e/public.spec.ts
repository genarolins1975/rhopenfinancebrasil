import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { expectNoA11yViolations } from "./a11y";

const state = () => JSON.parse(readFileSync(".e2e-state.json", "utf8")) as { password: string; comum: { email: string }; inviteToken: string };

test.describe("páginas públicas", () => {
  for (const path of ["/", "/entrar", "/recuperar-senha", "/privacidade", "/convite/token-invalido-de-tamanho-suficiente"]) {
    test(`A11Y-01 ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoA11yViolations(page);
    });
  }

  test("convite inválido não revela motivo; convite válido mostra formulário", async ({ page }) => {
    await page.goto("/convite/token-invalido-de-tamanho-suficiente");
    await expect(page.getByText("Convite inválido")).toBeVisible();
    await page.goto(`/convite/${state().inviteToken}`);
    await expect(page.getByLabel("Nova senha")).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("login com senha errada responde de forma neutra; login correto leva ao início", async ({ page }) => {
    await page.goto("/entrar");
    await page.getByLabel("Email corporativo").fill(state().comum.email);
    await page.getByLabel("Senha").fill("senha errada e longa o bastante");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Não foi possível entrar" })).toBeVisible();
    await page.getByLabel("Senha").fill(state().password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/inicio/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Olá, Colaborador");
    await expectNoA11yViolations(page);
  });

  test("rota protegida sem sessão redireciona para entrar", async ({ page }) => {
    await page.goto("/admin/colaboradores");
    await expect(page).toHaveURL(/\/entrar/);
  });
});
