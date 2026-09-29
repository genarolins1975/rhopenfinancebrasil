import type { EmailMessage } from "./email";

/** Mensagens curtas, com link autenticado e sem conteúdo pessoal. */
export function inviteEmail(to: string, name: string, url: string, expiresAtLocal: string): EmailMessage {
  return {
    to,
    subject: "Seu acesso ao Portal do Colaborador",
    text: [
      `Olá, ${name}.`,
      "",
      "Você foi cadastrado no Portal do Colaborador da Associação Open Finance Brasil.",
      `Defina sua senha pelo link abaixo. Ele é individual, de uso único e vale até ${expiresAtLocal}.`,
      "",
      url,
      "",
      "Se você não esperava este convite, ignore esta mensagem.",
    ].join("\n"),
  };
}

export function passwordResetEmail(to: string, url: string): EmailMessage {
  return {
    to,
    subject: "Redefinição de senha",
    text: [
      "Recebemos um pedido de redefinição de senha para o Portal do Colaborador.",
      "Se foi você, use o link abaixo. Ele expira em 60 minutos.",
      "",
      url,
      "",
      "Se não foi você, nenhuma ação é necessária.",
    ].join("\n"),
  };
}

export function emailChangeConfirmation(to: string, newEmailMasked: string, url: string): EmailMessage {
  return {
    to,
    subject: "Confirmação de troca de email",
    text: [
      `Foi solicitada a troca do email de acesso ao Portal do Colaborador para ${newEmailMasked}.`,
      "Se foi você, confirme pelo link abaixo. Se não foi, entre em contato com o RH.",
      "",
      url,
    ].join("\n"),
  };
}

export function emailVerification(to: string, url: string): EmailMessage {
  return {
    to,
    subject: "Verificação de email",
    text: ["Confirme este endereço para o Portal do Colaborador pelo link abaixo.", "", url].join("\n"),
  };
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const visible = local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}
