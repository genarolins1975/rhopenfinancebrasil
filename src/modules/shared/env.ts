import { z } from "zod";

const base64Key = z
  .string()
  .min(1)
  .refine((v) => Buffer.from(v, "base64").length === 32, "chave deve ter 32 bytes em base64");

const schema = z.object({
  // demo: ambiente de demonstração com dados fictícios (DEC-45); nunca com dados reais.
  APP_ENV: z.enum(["development", "test", "homolog", "demo", "production"]).default("development"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  DATABASE_OWNER_URL: z.string().optional(),
  /** Conexões por processo. Em funções serverless (Vercel), manter baixo. */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  /** Fuso também na abertura da sessão (defesa em profundidade; o papel e o banco já o fixam). "off" onde o proxy não aceita o parâmetro. */
  DATABASE_TZ_OPTION: z.enum(["on", "off"]).default("on"),
  BETTER_AUTH_SECRET: z.string().min(32),
  CPF_ENC_KEY_V1: base64Key,
  CPF_HMAC_KEY_V1: base64Key,
  CPF_KEY_VERSION: z.coerce.number().int().min(1).default(1),
  IMPORT_ENC_KEY_V1: base64Key,
  // none: nada é enviado; a notificação fica registrada como bloqueada (demonstração sem provedor de email).
  EMAIL_TRANSPORT: z.enum(["file", "smtp", "memory", "none"]).default("file"),
  EMAIL_FROM: z.string().min(3).default("Portal do Colaborador <portal@example.invalid>"),
  SMTP_URL: z.string().optional(),
  EMAIL_ALLOWLIST: z.string().optional(),
  PASSWORD_BREACH_CHECK: z.enum(["on", "off"]).default("off"),
  TRUSTED_IP_HEADER: z.string().optional(),
  LOG_LEVEL: z.string().default("info"),
  /** Segredo da rota agendada de operação (outbox e varreduras); a Vercel o envia no cabeçalho Authorization. */
  CRON_SECRET: z.string().min(32).optional(),
  /** Demonstração (DEC-46): "on" dispensa o segundo fator dos perfis privilegiados. Recusado fora de APP_ENV=demo. */
  DEMO_MFA_OPTIONAL: z.enum(["on", "off"]).default("off"),
}).refine((e) => e.DEMO_MFA_OPTIONAL === "off" || e.APP_ENV === "demo", { path: ["DEMO_MFA_OPTIONAL"], message: "só vale em APP_ENV=demo" });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Lê e valida as variáveis de ambiente uma única vez. Falha cedo, sem expor valores. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const campos = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Variáveis de ambiente inválidas ou ausentes: ${campos}`);
  }
  cached = parsed.data;
  return cached;
}

export const isProduction = () => env().APP_ENV === "production";
export const isTest = () => env().APP_ENV === "test";

/**
 * Segundo fator dispensado para perfis privilegiados (DEC-46). Lido do processo a cada chamada e só com APP_ENV=demo:
 * fora da demonstração nenhuma combinação de variáveis dispensa o segundo fator (PAR-33).
 */
export const mfaWaived = () => process.env.APP_ENV === "demo" && process.env.DEMO_MFA_OPTIONAL === "on";
