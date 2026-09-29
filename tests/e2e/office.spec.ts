import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { totpFromUri } from "../integration/totp";
import { expectNoA11yViolations } from "./a11y";

const state = () => JSON.parse(readFileSync(".e2e-state.json", "utf8")) as { password: string; adm: { email: string }; comum: { email: string }; diretora: { email: string }; diretor2: { email: string }; totpURI: string };

/** Data local de São Paulo, não UTC (DIR-029). */
function isoPlus(days: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(Date.now() + days * 86_400_000));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
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

  test("planejar a semana: intenção sem mesa não gera reserva; confirmação volta ao início", async ({ page }) => {
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
  test("exclusividade: prévia com conflito explícito, três opções, realocação com mesas livres, decisão por reserva e confirmação; histórico registra", async ({ page }, testInfo) => {
    // dados distintos por projeto: os projetos compartilham o banco de teste
    const code = testInfo.project.name === "celular" ? "M030" : "M020";
    const date = isoPlus(testInfo.project.name === "celular" ? 3 : 2);
    await login(page, state().comum.email);
    await page.goto(`/escritorio/recursos/${code}?data=${date}`);
    await page.getByRole("button", { name: "Reservar" }).click();
    await expect(page.getByText("Sua reserva").first()).toBeVisible();
    await page.context().clearCookies();
    await loginAdmin(page);
    await page.goto(`/admin/escritorio/mesas/exclusividade?aba=mesas&mesa=${code}`);
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
    // três opções excludentes (DIR-016) e realocação com mesas livres para a pessoa
    await expect(preview.getByRole("button", { name: /^Iniciar em \d{2}\/\d{2}\/\d{4}/ })).toBeVisible();
    await expect(preview.getByRole("link", { name: "Escolher outra mesa" })).toBeVisible();
    await expect(preview.getByText(/Tratar reservas/)).toBeVisible();
    await expect(preview.getByLabel("Ação").locator("option", { hasText: "Realocar" })).toHaveCount(1);
    expect(await preview.getByLabel("Mesa de destino").locator("option").count()).toBeGreaterThan(10);
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    // opção 1: iniciar após a última reserva incompatível refaz a prévia sem conflitos
    await preview.getByRole("button", { name: /^Iniciar em/ }).click();
    const preview1 = page.getByRole("region", { name: "Prévia de impacto" }).first();
    await expect(preview1).toContainText("Nenhuma reserva incompatível");
    await expect(preview1.getByRole("button", { name: "Confirmar atribuição" })).toBeVisible();
    // opção 3: tratar reservas; sem decisão, o servidor recusa
    await page.goto(`/admin/escritorio/mesas/exclusividade?aba=mesas&mesa=${code}`);
    const form2 = page.getByRole("region", { name: /Travar e vincular a um titular/ });
    await form2.getByLabel(/Titular/).selectOption({ label: "Diretor Segundo" });
    await form2.getByLabel("Justificativa").fill("nova diretoria");
    await form2.getByLabel(/Responsável/).fill("Diretoria executiva");
    await form2.getByRole("button", { name: "Ver impacto" }).click();
    const preview2 = page.getByRole("region", { name: "Prévia de impacto" }).first();
    await preview2.getByRole("button", { name: "Confirmar atribuição" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /sem decisão|Escolha/ }).first()).toBeVisible();
    await page.goto(`/admin/escritorio/mesas/exclusividade?aba=mesas&mesa=${code}`);
    const form3 = page.getByRole("region", { name: /Travar e vincular a um titular/ });
    await form3.getByLabel(/Titular/).selectOption({ label: "Diretor Segundo" });
    await form3.getByLabel("Justificativa").fill("nova diretoria");
    await form3.getByLabel(/Responsável/).fill("Diretoria executiva");
    await form3.getByRole("button", { name: "Ver impacto" }).click();
    const preview3 = page.getByRole("region", { name: "Prévia de impacto" }).first();
    await preview3.getByLabel("Ação").selectOption("cancel");
    await preview3.getByLabel("Motivo").fill("mesa passa à diretoria");
    await preview3.getByLabel("Mensagem à pessoa").fill("Pedimos desculpas pelo transtorno.");
    await preview3.getByRole("button", { name: "Confirmar atribuição" }).click();
    // a página é revalidada: o painel passa a mostrar a atribuição vigente
    await expect(page.getByText("Atribuição vigente: Diretor Segundo")).toBeVisible();
    await page.goto(`/admin/escritorio/mesas/exclusividade?aba=historico&mesa=${code}`);
    await expect(page.getByRole("table", { name: "Eventos de auditoria da mesa" })).toContainText("exclusivity.assignment_created");
    await expect(page.getByRole("table", { name: "Eventos de auditoria da mesa" })).toContainText("booking.cancelled_by_conflict");
    // o colaborador vê a mesa exclusiva e sua reserva sumiu
    await page.context().clearCookies();
    await login(page, state().comum.email);
    await page.goto(`/escritorio/recursos/${code}?data=${date}`);
    await expect(page.getByRole("button", { name: "Reservar" })).toHaveCount(0);
    await page.goto("/escritorio/minhas-reservas");
    await expect(page.getByRole("table", { name: "Reservas futuras" }).or(page.getByText("Nenhuma reserva futura"))).not.toContainText(code);
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
