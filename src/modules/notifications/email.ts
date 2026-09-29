import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import { env } from "@/modules/shared/env";
import { logger } from "@/modules/shared/logger";

export type EmailMessage = { to: string; subject: string; text: string; html?: string };

export type SendResult = { id: string; blocked?: boolean };

export interface EmailSender {
  send(message: EmailMessage): Promise<SendResult>;
}

/** Captura em memória para testes. */
export const memoryMailbox: EmailMessage[] = [];

class MemorySender implements EmailSender {
  async send(message: EmailMessage) {
    memoryMailbox.push(message);
    return { id: `memory-${memoryMailbox.length}` };
  }
}

/** Desenvolvimento: grava .eml em .dev-mail e nunca envia. */
class FileSender implements EmailSender {
  async send(message: EmailMessage) {
    const dir = path.resolve(".dev-mail");
    await mkdir(dir, { recursive: true });
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const raw = [
      `From: ${env().EMAIL_FROM}`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      message.text,
    ].join("\r\n");
    await writeFile(path.join(dir, `${id}.eml`), raw, "utf8");
    logger.info({ to: message.to, subject: message.subject, file: `${id}.eml` }, "email gravado em .dev-mail");
    return { id };
  }
}

class SmtpSender implements EmailSender {
  private transport = nodemailer.createTransport(env().SMTP_URL);
  async send(message: EmailMessage) {
    const info = await this.transport.sendMail({
      from: env().EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return { id: info.messageId };
  }
}

function allowlisted(to: string): boolean {
  const list = env().EMAIL_ALLOWLIST;
  if (!list) return true;
  const allowed = list.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(to.toLowerCase());
}

let sender: EmailSender | undefined;

export function getEmailSender(): EmailSender {
  if (sender) return sender;
  const kind = env().EMAIL_TRANSPORT;
  const inner: EmailSender = kind === "memory" ? new MemorySender() : kind === "smtp" ? new SmtpSender() : new FileSender();
  sender = {
    async send(message) {
      if (!allowlisted(message.to)) {
        logger.warn({ to: message.to }, "destinatário fora da lista permitida; envio bloqueado");
        return { id: "blocked-by-allowlist", blocked: true };
      }
      return inner.send(message);
    },
  };
  return sender;
}

export function resetEmailSenderForTests() {
  sender = undefined;
  memoryMailbox.length = 0;
}
