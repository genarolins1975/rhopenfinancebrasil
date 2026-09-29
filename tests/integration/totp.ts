import { createHmac } from "node:crypto";

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/=+$/, "").toUpperCase();
  let bits = "";
  for (const c of clean) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** Código TOTP (RFC 6238) a partir do URI otpauth devolvido pelo Better Auth. */
export function totpFromUri(uri: string, at = Date.now()): string {
  const u = new URL(uri);
  const secret = base32Decode(u.searchParams.get("secret") ?? "");
  const period = Number(u.searchParams.get("period") ?? 30);
  const digits = Number(u.searchParams.get("digits") ?? 6);
  const algorithm = (u.searchParams.get("algorithm") ?? "SHA1").toLowerCase();
  const counter = Math.floor(at / 1000 / period);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac(algorithm, secret).update(msg).digest();
  const offset = h[h.length - 1] & 0x0f;
  const code = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(code % 10 ** digits).padStart(digits, "0");
}
