"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { isDomainError } from "@/modules/shared/errors";
import { logger } from "@/modules/shared/logger";
import { auth } from "./auth";
import { acceptInvitation } from "./invitations";
import { checkPasswordPolicy, isPasswordBreached } from "./password";
import { getCurrent } from "./session";
import { isThrottled, registerAttempt } from "./throttle";

export type ActionState = { ok?: boolean; error?: string; message?: string; data?: Record<string, unknown> };

const NEUTRAL_LOGIN = "Não foi possível entrar com estes dados. Confira o email e a senha.";

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

export async function signInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = str(formData, "email").trim().toLowerCase();
  const password = str(formData, "password");
  const keep = { data: { email } };
  if (!email || !password) return { error: NEUTRAL_LOGIN, ...keep };
  if (await isThrottled(db, email)) {
    logger.warn({ emailKey: "throttled" }, "tentativas excedidas para uma conta");
    return { error: NEUTRAL_LOGIN, ...keep };
  }
  let next = "/inicio";
  try {
    const result = await auth.api.signInEmail({ body: { email, password }, headers: await headers() });
    await registerAttempt(db, email, true);
    if ((result as { twoFactorRedirect?: boolean }).twoFactorRedirect) next = "/mfa";
  } catch (e) {
    await registerAttempt(db, email, false);
    if (e instanceof APIError) return { error: NEUTRAL_LOGIN, ...keep };
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "erro inesperado no login");
    return { error: "Não foi possível entrar agora. Tente de novo em instantes.", ...keep };
  }
  redirect(next);
}

export async function verifyTotpAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const code = str(formData, "code").replace(/\s+/g, "");
  const useBackup = str(formData, "kind") === "backup";
  try {
    if (useBackup) await auth.api.verifyBackupCode({ body: { code, trustDevice: false }, headers: await headers() });
    else await auth.api.verifyTOTP({ body: { code, trustDevice: false }, headers: await headers() });
  } catch (e) {
    if (e instanceof APIError) return { error: "Código inválido ou expirado. Tente de novo." };
    return { error: "Não foi possível verificar agora." };
  }
  redirect("/inicio");
}

export async function signOutAction(): Promise<void> {
  try {
    await auth.api.signOut({ headers: await headers() });
  } catch {
    /* sessão já encerrada */
  }
  redirect("/entrar");
}

export async function acceptInvitationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const token = str(formData, "token");
  const password = str(formData, "password");
  const confirm = str(formData, "confirm");
  if (password !== confirm) return { error: "As senhas não coincidem." };
  try {
    await acceptInvitation(db, token, password);
  } catch (e) {
    if (isDomainError(e)) return { error: e.message };
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "erro ao aceitar convite");
    return { error: "Não foi possível concluir agora. Tente de novo em instantes." };
  }
  redirect("/entrar?aviso=senha-definida");
}

const NEUTRAL_RESET = "Se o email estiver cadastrado, você receberá as instruções em instantes.";

export async function requestPasswordResetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = str(formData, "email").trim().toLowerCase();
  if (!email) return { error: "Informe o email." };
  try {
    await auth.api.requestPasswordReset({ body: { email, redirectTo: "/redefinir-senha" }, headers: await headers() });
  } catch (e) {
    // Resposta idêntica exista ou não a conta.
    logger.info({ err: e instanceof APIError ? e.status : "n/a" }, "pedido de recuperação processado");
  }
  return { ok: true, message: NEUTRAL_RESET };
}

export async function resetPasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const token = str(formData, "token");
  const password = str(formData, "password");
  const confirm = str(formData, "confirm");
  if (password !== confirm) return { error: "As senhas não coincidem." };
  const policy = checkPasswordPolicy(password);
  if (!policy.ok) return { error: policy.reason };
  if (await isPasswordBreached(password)) return { error: "Esta senha apareceu em vazamentos conhecidos. Escolha outra." };
  try {
    await auth.api.resetPassword({ body: { token, newPassword: password }, headers: await headers() });
  } catch (e) {
    if (e instanceof APIError) return { error: "Link inválido ou expirado. Peça uma nova recuperação." };
    return { error: "Não foi possível concluir agora." };
  }
  redirect("/entrar?aviso=senha-redefinida");
}

export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const current = await getCurrent();
  if (!current) redirect("/entrar");
  const currentPassword = str(formData, "currentPassword");
  const password = str(formData, "password");
  const confirm = str(formData, "confirm");
  if (password !== confirm) return { error: "As senhas não coincidem." };
  const policy = checkPasswordPolicy(password, { email: current.user.email, name: current.user.name });
  if (!policy.ok) return { error: policy.reason };
  if (await isPasswordBreached(password)) return { error: "Esta senha apareceu em vazamentos conhecidos. Escolha outra." };
  try {
    await auth.api.changePassword({ body: { currentPassword, newPassword: password, revokeOtherSessions: true }, headers: await headers() });
  } catch (e) {
    if (e instanceof APIError) return { error: "Senha atual incorreta." };
    return { error: "Não foi possível concluir agora." };
  }
  return { ok: true, message: "Senha alterada. As outras sessões foram encerradas." };
}

export async function enableTwoFactorAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const current = await getCurrent();
  if (!current) redirect("/entrar");
  const password = str(formData, "password");
  try {
    const res = await auth.api.enableTwoFactor({ body: { password, issuer: "Portal do Colaborador AOF" }, headers: await headers() });
    const { totpURI, backupCodes } = res as { totpURI: string; backupCodes: string[] };
    const { toString } = await import("qrcode");
    const svg = await toString(totpURI, { type: "svg", margin: 1, width: 200 });
    return { ok: true, data: { totpURI, backupCodes, svg } };
  } catch (e) {
    if (e instanceof APIError) return { error: "Senha incorreta." };
    logger.error({ err: e instanceof Error ? e.message : String(e) }, "erro ao ativar segundo fator");
    return { error: "Não foi possível ativar agora." };
  }
}

export async function confirmTwoFactorAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const current = await getCurrent();
  if (!current) redirect("/entrar");
  const code = str(formData, "code").replace(/\s+/g, "");
  try {
    await auth.api.verifyTOTP({ body: { code, trustDevice: false }, headers: await headers() });
  } catch (e) {
    if (e instanceof APIError) return { error: "Código inválido. Confira o relógio do aplicativo e tente de novo." };
    return { error: "Não foi possível verificar agora." };
  }
  return { ok: true, message: "Segundo fator ativado." };
}

export async function revokeOtherSessionsAction(): Promise<ActionState> {
  const current = await getCurrent();
  if (!current) redirect("/entrar");
  try {
    await auth.api.revokeOtherSessions({ headers: await headers() });
  } catch {
    return { error: "Não foi possível encerrar as outras sessões agora." };
  }
  return { ok: true, message: "As outras sessões foram encerradas." };
}

export async function requestEmailChangeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const current = await getCurrent();
  if (!current) redirect("/entrar");
  const newEmail = str(formData, "newEmail").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return { error: "Informe um email válido." };
  try {
    await auth.api.changeEmail({ body: { newEmail, callbackURL: "/perfil?aviso=email-confirmado" }, headers: await headers() });
  } catch (e) {
    if (e instanceof APIError) return { error: "Não foi possível iniciar a troca. Confira o email informado." };
    return { error: "Não foi possível concluir agora." };
  }
  return { ok: true, message: "Enviamos uma confirmação para o seu email atual. A troca só vale depois dela." };
}
