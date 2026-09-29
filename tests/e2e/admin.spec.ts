import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { formatCpf, syntheticCpf } from "@/modules/employees/cpf";
import { totpFromUri } from "../integration/totp";
import { expectNoA11yViolations } from "./a11y";

const state = () => JSON.parse(readFileSync(".e2e-state.json", "utf8")) as { password: string; adm: { email: string }; comum: { email: string }; totpURI: string };

async function loginAdmin(page: Page) {
  const s = state();
  await page.goto("/entrar");
  await page.getByLabel("Email corporativo").fill(s.adm.email);
  await page.getByLabel("Senha").fill(s.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/mfa/);
  await page.getByLabel("Código de 6 dígitos").fill(totpFromUri(s.totpURI));
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page).toHaveURL(/\/inicio/);
}

test.describe("ambiente administrativo", () => {
  test("colaborador comum não entra no admin", async ({ page }) => {
    const s = state();
    await page.goto("/entrar");
    await page.getByLabel("Email corporativo").fill(s.comum.email);
    await page.getByLabel("Senha").fill(s.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/inicio/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/inicio\?aviso=sem-permissao/);
    await expect(page.getByText("não está disponível para o seu perfil")).toBeVisible();
  });

  test("admin com segundo fator entra, vê a lista sem CPF e cadastra pessoa com convite", async ({ page }, testInfo) => {
    // Dados únicos por projeto: os projetos compartilham o banco de teste.
    const seed = testInfo.project.name === "celular" ? 7707 : 7706;
    await loginAdmin(page);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("atenção hoje");
    await expectNoA11yViolations(page);
    await page.goto("/admin/colaboradores");
    await expect(page.getByRole("table")).toBeVisible();
    const html = await page.content();
    expect(html).not.toMatch(/\b\d{11}\b/);
    await expectNoA11yViolations(page);
    await page.goto("/admin/colaboradores/novo");
    await expectNoA11yViolations(page);
    await page.getByLabel("Nome completo").fill("Pessoa Cadastrada Pelo Teste");
    await page.getByLabel("Email corporativo").fill(`cadastrada-${testInfo.project.name}@teste.invalid`);
    await page.getByLabel("CPF").fill(formatCpf(syntheticCpf(seed)));
    await page.getByLabel("Data de admissão").fill("2026-10-01");
    await page.getByRole("button", { name: "Cadastrar" }).click();
    await expect(page).toHaveURL(/\/admin\/colaboradores\/[0-9a-f-]+\?aviso=criado/);
    await expect(page.getByText("Pessoa cadastrada.")).toBeVisible();
    await expect(page.getByText(`•••.•••.•••-${syntheticCpf(seed).slice(9)}`)).toBeVisible();
    await expectNoA11yViolations(page);
    await page.goto("/admin/auditoria?action=employee.created");
    await expect(page.getByRole("table")).toContainText("employee.created");
    await expectNoA11yViolations(page);
  });

  test("revelar CPF exige motivo e fica na auditoria", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin/colaboradores?q=Colaborador%20Exemplo");
    await page.getByRole("link", { name: "Colaborador Exemplo" }).click();
    await page.getByRole("button", { name: "Revelar" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Motivo").fill("conferência no teste ponta a ponta");
    await dialog.getByRole("button", { name: "Revelar" }).click();
    await expect(page.locator("dd").filter({ hasText: /\d{3}\.\d{3}\.\d{3}-\d{2}/ })).toBeVisible();
    await page.goto("/admin/auditoria?action=cpf.revealed");
    await expect(page.getByRole("table")).toContainText("cpf.revealed");
  });

  test("importação: prévia mascarada e confirmação", async ({ page }, testInfo) => {
    const seed = testInfo.project.name === "celular" ? 8871 : 8870;
    await loginAdmin(page);
    await page.goto("/admin/colaboradores/importar");
    await expectNoA11yViolations(page);
    const csv = `nome;email;cpf;area;cargo;gestor_email;condicao;data_admissao\nImportada Um;importada-${testInfo.project.name}@teste.invalid;${formatCpf(syntheticCpf(seed))};Tecnologia;Analista;;colaborador;01/10/2026\n`;
    await page.getByLabel(/Arquivo CSV/).setInputFiles({ name: "pessoas.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
    await page.getByRole("button", { name: "Gerar prévia" }).click();
    await expect(page.getByRole("table")).toContainText("pronta");
    expect(await page.content()).not.toMatch(/\b\d{11}\b/);
    await page.getByRole("button", { name: /Confirmar importação/ }).click();
    await expect(page.getByRole("status")).toContainText("cadastrada(s) e convidada(s)");
  });
});
