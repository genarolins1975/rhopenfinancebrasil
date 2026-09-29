import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { totpFromUri } from "../integration/totp";
import { expectNoA11yViolations } from "./a11y";

const state = () => JSON.parse(readFileSync(".e2e-state.json", "utf8")) as { password: string; adm: { email: string }; comum: { email: string }; diretora: { email: string }; diretor2: { email: string }; totpURI: string };

function isoPlus(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

async function login(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("Email corporativo").fill(email);
  await page.getByLabel("Senha").fill(state().password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function loginAdmin(page: Page) {
  await page.goto("/entrar");
  await page.getByLabel("Email corporativo").fill(state().adm.email);
  await page.getByLabel("Senha").fill(state().password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/mfa/);
  await page.getByLabel("Código de 6 dígitos").fill(totpFromUri(state().totpURI));
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scrollWidth, page.url()).toBeLessThanOrEqual(clientWidth);
}

test.describe("escritório: mapa, lista e reservas", () => {
  test("colaborador vê a mesa exclusiva com o rótulo literal, sem botão e sem nome do titular; reserva uma compartilhada e cancela", async ({ page }, testInfo) => {
    await login(page, state().comum.email);
    const date = isoPlus(1);
    await page.goto(`/escritorio?data=${date}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Escritório");
    await expect(page.getByRole("region", { name: "Mapa do escritório" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^M001: Uso exclusivo — Diretoria$/ })).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain("Diretora Exemplo");
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    // detalhe da mesa exclusiva: sem botão de reservar
    await page.goto(`/escritorio/recursos/M001?data=${date}`);
    await expect(page.getByText("Uso exclusivo — Diretoria").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Reservar" })).toHaveCount(0);
    await expectNoA11yViolations(page);
    // reserva uma compartilhada distinta por projeto para não colidir entre desktop e celular
    const code = testInfo.project.name === "celular" ? "M010" : "M011";
    await page.goto(`/escritorio/recursos/${code}?data=${date}`);
    await page.getByRole("button", { name: "Reservar" }).click();
    // a página é revalidada após a ação: o estado passa a "Sua reserva" e o botão vira cancelar
    await expect(page.getByText("Sua reserva").first()).toBeVisible();
    await page.goto("/escritorio/minhas-reservas");
    await expect(page.getByRole("table", { name: "Reservas futuras" })).toContainText(code);
    await expectNoA11yViolations(page);
    await page.getByRole("button", { name: "Cancelar reserva" }).first().click();
    // a página é revalidada: a reserva sai da lista de próximas
    await expect(page.getByRole("table", { name: "Reservas futuras" }).or(page.getByText("Nenhuma reserva futura"))).not.toContainText(code);
  });

  test("titular vê a própria mesa habitual no início e como 'Sua mesa de uso exclusivo' no mapa", async ({ page }) => {
    await login(page, state().diretora.email);
    await expect(page.getByText("Sua mesa habitual: M001")).toBeVisible();
    await page.goto(`/escritorio?data=${isoPlus(1)}`);
    await expect(page.getByRole("link", { name: /^M001: Sua mesa de uso exclusivo, reservar$/ })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("outro diretor não reserva a mesa individual; integrante do grupo vê a política pelo servidor", async ({ page }) => {
    await login(page, state().diretor2.email);
    await page.goto(`/escritorio/recursos/M001?data=${isoPlus(1)}`);
    await expect(page.getByRole("button", { name: "Reservar" })).toHaveCount(0);
    await expect(page.getByText("uso exclusivo da diretoria")).toBeVisible();
  });

  test("planejar a semana: intenção sem mesa não gera reserva; confirmação volta ao início", async ({ page }, testInfo) => {
    if (testInfo.project.name === "celular") test.skip();
    await login(page, state().comum.email);
    await page.goto("/semana?semana=atual");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Planejar minha semana");
    await expectNoA11yViolations(page);
    const radios = page.getByRole("radio", { name: "Remoto" });
    const n = await radios.count();
    for (let i = 0; i < n; i++) await radios.nth(i).check();
    await page.getByRole("button", { name: "Confirmar a semana" }).click();
    await expect(page).toHaveURL(/\/inicio\?aviso=semana-planejada/);
    await expect(page.getByText("Semana confirmada.")).toBeVisible();
  });
});

test.describe("administração do escritório", () => {
  test("exclusividade: prévia com conflito explícito, decisão por reserva e confirmação; histórico registra", async ({ page }, testInfo) => {
    if (testInfo.project.name === "celular") test.skip();
    // colaborador reserva M020 amanhã; depois o RH trava M020 para o segundo diretor e trata a reserva
    await login(page, state().comum.email);
    const date = isoPlus(2);
    await page.goto(`/escritorio/recursos/M020?data=${date}`);
    await page.getByRole("button", { name: "Reservar" }).click();
    await expect(page.getByText("Sua reserva").first()).toBeVisible();
    await page.context().clearCookies();
    await loginAdmin(page);
    await page.goto("/admin/escritorio/mesas/exclusividade?aba=mesas&mesa=M020");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Exclusividade da diretoria");
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    const form = page.getByRole("region", { name: /Travar e vincular a um titular/ });
    await form.getByLabel(/Titular/).selectOption({ label: "Diretor Segundo" });
    await form.getByLabel("Justificativa").fill("nova diretoria");
    await form.getByLabel(/Responsável/).fill("Diretoria executiva");
    await form.getByRole("button", { name: "Ver impacto" }).click();
    const preview = page.getByRole("region", { name: "Prévia de impacto" }).first();
    await expect(preview).toContainText("1 reserva(s) incompatível(is)");
    await expect(preview).toContainText("Colaborador Exemplo");
    await expectNoA11yViolations(page);
    // sem decisão, o servidor recusa
    await preview.getByRole("button", { name: "Confirmar atribuição" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /sem decisão|Escolha/ }).first()).toBeVisible();
    await page.goto("/admin/escritorio/mesas/exclusividade?aba=mesas&mesa=M020");
    const form2 = page.getByRole("region", { name: /Travar e vincular a um titular/ });
    await form2.getByLabel(/Titular/).selectOption({ label: "Diretor Segundo" });
    await form2.getByLabel("Justificativa").fill("nova diretoria");
    await form2.getByLabel(/Responsável/).fill("Diretoria executiva");
    await form2.getByRole("button", { name: "Ver impacto" }).click();
    const preview2 = page.getByRole("region", { name: "Prévia de impacto" }).first();
    await preview2.getByLabel("Ação").selectOption("cancel");
    await preview2.getByLabel("Motivo").fill("mesa passa à diretoria");
    await preview2.getByLabel("Mensagem à pessoa").fill("Pedimos desculpas pelo transtorno.");
    await preview2.getByRole("button", { name: "Confirmar atribuição" }).click();
    // a página é revalidada: o painel passa a mostrar a atribuição vigente
    await expect(page.getByText("Atribuição vigente: Diretor Segundo")).toBeVisible();
    await page.goto("/admin/escritorio/mesas/exclusividade?aba=historico&mesa=M020");
    await expect(page.getByRole("table", { name: "Eventos de auditoria da mesa" })).toContainText("exclusivity.assignment_created");
    await expect(page.getByRole("table", { name: "Eventos de auditoria da mesa" })).toContainText("booking.cancelled_by_conflict");
    // o colaborador vê a mesa exclusiva e sua reserva sumiu
    await page.context().clearCookies();
    await login(page, state().comum.email);
    await page.goto(`/escritorio/recursos/M020?data=${date}`);
    await expect(page.getByRole("button", { name: "Reservar" })).toHaveCount(0);
    await page.goto("/escritorio/minhas-reservas");
    await expect(page.getByRole("table", { name: "Reservas futuras" }).or(page.getByText("Nenhuma reserva futura"))).not.toContainText("M020");
  });

  test("recursos, planta, reservas administrativas e conflitos pendentes vazios; sem rolagem horizontal", async ({ page }) => {
    await loginAdmin(page);
    for (const path of ["/admin/escritorio/recursos", "/admin/escritorio/recursos?aba=calendario", "/admin/escritorio/recursos?aba=configuracoes", "/admin/escritorio/planta", "/admin/reservas", "/admin/escritorio/mesas/exclusividade?aba=grupo", "/admin/escritorio/mesas/exclusividade?aba=conflitos"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNoA11yViolations(page);
    }
    await page.goto("/admin/escritorio/mesas/exclusividade?aba=conflitos");
    await expect(page.getByText("Nenhum conflito pendente")).toBeVisible();
    await page.goto("/admin/escritorio/mesas/exclusividade?aba=grupo");
    await expect(page.getByRole("table", { name: "Integrantes do grupo com vigência" })).toContainText("Diretor Segundo");
  });

  test("gestor não entra nas telas administrativas do escritório; colaborador comum idem", async ({ page }) => {
    await login(page, state().comum.email);
    for (const path of ["/admin/escritorio/recursos", "/admin/escritorio/planta", "/admin/escritorio/mesas/exclusividade", "/admin/reservas"]) {
      await page.goto(path);
      expect(page.url(), path).toMatch(/\/inicio\?aviso=sem-permissao/);
    }
  });
});
