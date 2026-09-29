import { randomUUID, randomBytes, createHash } from "node:crypto";

export const newId = () => randomUUID();

/** Token aleatório seguro para URL (32 bytes). Só o hash vai ao banco. */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
