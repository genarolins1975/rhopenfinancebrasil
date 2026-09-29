import { and, eq, gte, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { loginAttempt } from "@/db/schema";
import { sha256Hex } from "@/modules/shared/ids";

/** PAR-11: cinco falhas em dez minutos por conta bloqueiam novas tentativas, com resposta neutra. */
export const THROTTLE_MAX_FAILURES = 5;
export const THROTTLE_WINDOW_SECONDS = 600;

export function emailKey(email: string): string {
  return sha256Hex(email.trim().toLowerCase());
}

export async function isThrottled(db: DbOrTx, email: string): Promise<boolean> {
  const since = new Date(Date.now() - THROTTLE_WINDOW_SECONDS * 1000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempt)
    .where(and(eq(loginAttempt.emailHash, emailKey(email)), eq(loginAttempt.success, false), gte(loginAttempt.attemptedAt, since)));
  return (row?.n ?? 0) >= THROTTLE_MAX_FAILURES;
}

export async function registerAttempt(db: DbOrTx, email: string, success: boolean): Promise<void> {
  await db.insert(loginAttempt).values({ emailHash: emailKey(email), success });
}
