import { z } from "zod";

const base64Key = z
  .string()
  .min(1)
  .refine((v) => Buffer.from(v, "base64").length === 32, "chave deve ter 32 bytes em base64");

const schema = z.object({
  APP_ENV: z.enum(["development", "test", "homolog", "production"]).default("development"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  DATABASE_OWNER_URL: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().min(32),
  CPF_ENC_KEY_V1: base64Key,
  CPF_HMAC_KEY_V1: base64Key,
  CPF_KEY_VERSION: z.coerce.number().int().min(1).default(1),
  IMPORT_ENC_KEY_V1: base64Key,
  EMAIL_TRANSPORT: z.enum(["file", "smtp", "memory"]).default("file"),
  EMAIL_FROM: z.string().min(3).default("Portal do Colaborador <portal@example.invalid>"),
  SMTP_URL: z.string().optional(),
  EMAIL_ALLOWLIST: z.string().optional(),
  PASSWORD_BREACH_CHECK: z.enum(["on", "off"]).default("off"),
  TRUSTED_IP_HEADER: z.string().optional(),
  LOG_LEVEL: z.string().default("info"),
});

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
