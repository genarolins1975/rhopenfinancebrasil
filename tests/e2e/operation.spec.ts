import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";
import { totpFromUri } from "../integration/totp";
import { expectNoA11yViolations } from "./a11y";

/* Etapa 3 de ponta a ponta: fila com oferta e aceite, confirmação de uso pelo portal e pelo QR, salas, Meu time e telas administrativas. */

type State = { password: string; adm: { email: string }; comum: { email: string }; gestor: { email: string }; diretora: { email: string }; diretor2: { email: string }; totpURI: string };
const state = () => JSON.parse(readFileSync(".e2e-state.json", "utf8")) as State;

function isoPlus(days: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(Date.now() + days * 86_400_000));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function fillLogin(page: Page, email: string) {
  await page.getByLabel("Email corporativo").fill(email);
  await page.getByLabel("Senha").fill(state().password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

async function login(page: Page, email: string) {
  await page.goto("/entrar");
  await fillLogin(page, email);
  await expect(page).toHaveURL(/\/inicio/);
}

async function loginAdmin(page: Page) {
  await page.goto("/entrar");
  await fillLogin(page, state().adm.email);
  await expect(page).toHaveURL(/\/mfa/);
  await page.getByLabel("Código de 6 dígitos").fill(totpFromUri(state().totpURI));
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page).toHaveURL(/\/inicio/);
}

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scrollWidth, page.url()).toBeLessThanOrEqual(clientWidth);
}

/**
 * Lota as mesas compartilhadas livres na data com pessoas sintéticas (só no banco de teste, papel dono).
 * A mesa exclusiva M001 fica de fora: ela nunca é oferecida pela fila a quem não é titular.
 */
/** Limpeza: as reservas sintéticas não podem vazar para os demais testes (elas cancelam, nunca apagam). */
async function releaseSyntheticDesks(date: string) {
  const pool = new Pool({ connectionString: process.env.DATABASE_OWNER_URL, max: 1 });
  try {
    await pool.query(`update desk_booking set status = 'cancelled', cancelled_at = now(), cancel_reason = 'limpeza do teste' where booking_date = $1::date and status = 'confirmed' and employee_id in (select id from employee where corporate_email like 'sintetica-%')`, [date]);
  } finally {
    await pool.end();
  }
}

async function fillSharedDesks(date: string, tag: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[a-z]+$/.test(tag)) throw new Error("parâmetro inválido");
  const pool = new Pool({ connectionString: process.env.DATABASE_OWNER_URL, max: 1 });
  try {
    await pool.query(`
      do $$
      declare r record; e uuid; n int := 0;
      begin
        for r in select id, code from resource
                  where type = 'desk' and retired_on is null and desk_class(id, '${date}'::date) = 'shared'
                    and not exists (select 1 from desk_booking b where b.resource_id = resource.id and b.booking_date = '${date}'::date
                                      and (b.status = 'confirmed' or (b.status = 'held' and b.hold_expires_at > now())))
                  order by code loop
          n := n + 1;
          insert into employee (full_name, corporate_email, status) values ('Pessoa Sintética ' || r.code, 'sintetica-' || lower(r.code) || '-${date}-${tag}@teste.invalid', 'active') returning id into e;
          insert into desk_booking (resource_id, employee_id, booking_date, status, origin, actor_employee_id) values (r.id, e, '${date}'::date, 'confirmed', 'self', e);
        end loop;
      end $$;`);
  } finally {
    await pool.end();
  }
}

test.describe("fila de espera", () => {
  test("sem mesa disponível, a pessoa entra na fila; um cancelamento administrativo gera a oferta; ela aceita e confirma o uso", async ({ page, browser }, testInfo) => {
    const today = isoPlus(0);
    // Pessoas sem mesa de grupo nem exclusiva; uma por projeto, porque a de um projeto termina com reserva hoje.
    const person = testInfo.project.name === "celular" ? state().comum : state().gestor;
    await fillSharedDesks(today, testInfo.project.name);
    await login(page, person.email);
    await page.goto(`/escritorio?data=${today}`);
    await expect(page.getByRole("heading", { name: "Nenhuma mesa disponível para você nesta data" })).toBeVisible();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await page.getByRole("button", { name: "Entrar na fila de espera" }).click();
    await expect(page.getByText(/Você entrou na fila|Você está na fila de espera/).first()).toBeVisible();
    // administração cancela uma reserva sintética com motivo: a oferta nasce na mesma transação
    const adminCtx = await browser.newContext();
    const admin = await adminCtx.newPage();
    await loginAdmin(admin);
    await admin.goto(`/admin/reservas?aba=mesas&data=${today}`);
    const row = admin.getByRole("row").filter({ hasText: "Pessoa Sintética" }).first();
    const code = ((await row.getByRole("cell").first().textContent()) ?? "").trim();
    expect(code).toMatch(/^M\d{3}$/);
    await row.getByLabel("Motivo (registrado na auditoria)").fill("teste de ponta a ponta da fila");
    await row.getByRole("button", { name: "Cancelar com motivo" }).click();
    await expect(admin.getByRole("row").filter({ hasText: code }).filter({ hasText: "retida para oferta da fila" })).toBeVisible();
    await admin.goto(`/admin/reservas?aba=fila&data=${today}`);
    await expect(admin.getByRole("table", { name: "Inscrições na fila, por ordem de entrada" })).toContainText("com oferta");
    await expectNoA11yViolations(admin);
    await adminCtx.close();
    // a pessoa vê a oferta e aceita
    await page.goto("/escritorio/minhas-reservas");
    await expect(page.getByText(`Mesa ${code} disponível para você`)).toBeVisible();
    await expectNoA11yViolations(page);
    await page.getByRole("button", { name: "Aceitar a mesa" }).click();
    await expect(page.getByRole("table", { name: "Reservas de mesa futuras" })).toContainText(code);
    // confirmação de uso pelo portal: declaração, não presença
    await page.getByRole("table", { name: "Reservas de mesa futuras" }).getByRole("button", { name: "Confirmar uso" }).click();
    await expect(page.getByText(/Uso confirmado às|Uso de .* confirmado/).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test.afterEach(async () => {
    await releaseSyntheticDesks(isoPlus(0));
  });
});

test.describe("confirmação de uso pelo QR", () => {
  test("QR sem sessão leva ao login e volta à mesa; o servidor resolve a reserva da titular; nada de terceiros aparece", async ({ page }) => {
    const today = isoPlus(0);
    await page.goto("/escritorio/qr/M001");
    await expect(page).toHaveURL(/\/entrar\?volta=%2Fescritorio%2Fqr%2FM001/);
    await expect(page.getByText("Entre para confirmar o uso da mesa lida pelo QR.")).toBeVisible();
    await fillLogin(page, state().diretora.email);
    await expect(page).toHaveURL(/\/escritorio\/qr\/M001$/);
    if (await page.getByText("Você não tem reserva confirmada em M001 hoje.").isVisible()) {
      await page.goto(`/escritorio/recursos/M001?data=${today}`);
      await page.getByRole("button", { name: "Reservar" }).click();
      await expect(page.getByText("Sua reserva").first()).toBeVisible();
      await page.goto("/escritorio/qr/M001");
    }
    const confirm = page.getByRole("button", { name: "Confirmar uso" });
    if (await confirm.isVisible()) {
      await expectNoA11yViolations(page);
      await confirm.click();
    }
    await expect(page.getByText(/Uso de M001 (confirmado|já confirmado)/).first()).toBeVisible();
    // QR de outra mesa: sem reserva própria, nenhuma informação da reserva alheia
    await page.goto("/escritorio/qr/M002");
    await expect(page.getByText("Você não tem reserva confirmada em M002 hoje.")).toBeVisible();
    expect(await page.content()).not.toContain("Pessoa Sintética");
  });
});

test.describe("salas e cabines", () => {
  test("busca por intervalo, reserva com título privado, agenda legível, conflito explicado e cancelamento", async ({ page }, testInfo) => {
    const date = isoPlus(1);
    const [start, end] = testInfo.project.name === "celular" ? ["14:00", "15:00"] : ["10:00", "11:00"];
    await login(page, state().comum.email);
    await page.goto(`/escritorio/salas?data=${date}&inicio=${start}&fim=${end}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Salas e cabines");
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "R1 · sala" }) });
    await card.getByLabel("Título (opcional)").fill("Alinhamento do projeto");
    await card.getByRole("button", { name: "Reservar R1" }).click();
    await expect(card.getByText(/sua reserva/)).toBeVisible();
    await expect(card.getByText(new RegExp(`Indisponível das ${start} às ${end}: ocupada`))).toBeVisible();
    await page.goto("/escritorio/minhas-reservas");
    const table = page.getByRole("table", { name: "Reservas de sala futuras" });
    await expect(table).toContainText("R1");
    await expect(table).toContainText("Alinhamento do projeto");
    await table.getByRole("row").filter({ hasText: `${start} às ${end}` }).getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByRole("table", { name: "Reservas de sala futuras" }).or(page.getByText("Nenhuma reserva de sala futura"))).not.toContainText(`${start} às ${end}`);
  });
});

test.describe("Meu time", () => {
  test("a pessoa autoriza no perfil; o gestor direto passa a ver os planos; colaborador sem team.view não entra", async ({ page, browser }) => {
    await login(page, state().comum.email);
    await page.goto("/escritorio/meu-time");
    await expect(page).toHaveURL(/\/inicio\?aviso=sem-permissao/);
    await page.goto("/perfil");
    const box = page.getByRole("checkbox", { name: /Meu gestor direto pode ver/ });
    await box.check();
    await page.getByRole("button", { name: "Gravar preferência" }).click();
    await expect(page.getByText(/passam a ser visíveis ao seu gestor direto/)).toBeVisible();
    const ctx = await browser.newContext();
    const gestor = await ctx.newPage();
    await login(gestor, state().gestor.email);
    await gestor.goto("/escritorio/meu-time");
    const team = gestor.getByRole("table", { name: "Planos da equipe" });
    await expect(team).toContainText("Colaborador Exemplo");
    await expect(team).not.toContainText("não autorizou");
    await expectNoA11yViolations(gestor);
    await expectNoHorizontalScroll(gestor);
    await ctx.close();
  });
});

test.describe("administração da operação", () => {
  test("parâmetros da fila e da confirmação, QR do recurso, aba de salas; sem rolagem horizontal", async ({ page }) => {
    await loginAdmin(page);
    await page.goto("/admin/escritorio/recursos?aba=configuracoes");
    await expect(page.getByLabel("Prazo da oferta da fila, em minutos úteis (PAR-05)")).toHaveValue("120");
    await expect(page.getByLabel(/Liberar mesa compartilhada sem confirmação de uso/)).toHaveValue("false");
    await expectNoA11yViolations(page);
    await page.goto("/admin/escritorio/recursos?aba=recursos&mesa=M001");
    await expect(page.getByRole("heading", { name: "QR de confirmação de uso" })).toBeVisible();
    await expect(page.getByText(/\/escritorio\/qr\/M001$/)).toBeVisible();
    await expectNoA11yViolations(page);
    await page.goto(`/admin/reservas?aba=salas&data=${isoPlus(1)}`);
    await expect(page.getByRole("heading", { name: /Salas e cabines em/ })).toBeVisible();
    await expectNoA11yViolations(page);
    await expectNoHorizontalScroll(page);
    await page.goto("/admin");
    await expect(page.getByText("Fila de espera hoje")).toBeVisible();
  });
});
