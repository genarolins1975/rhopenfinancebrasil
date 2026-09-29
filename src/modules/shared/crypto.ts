import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/**
 * AES 256 GCM com formato versão(1) || nonce(12) || texto cifrado || tag(16).
 * O nonce vem de CSPRNG a cada gravação; o AAD amarra o dado ao seu dono.
 */
export function encryptGcm(key: Buffer, keyVersion: number, plaintext: Buffer, aad: Buffer): Buffer {
  if (key.length !== 32) throw new Error("chave AES precisa ter 32 bytes");
  if (keyVersion < 1 || keyVersion > 255) throw new Error("versão de chave fora do intervalo");
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([keyVersion]), nonce, ct, tag]);
}

export function decryptGcm(keys: Record<number, Buffer>, blob: Buffer, aad: Buffer): Buffer {
  if (blob.length < 1 + NONCE_BYTES + TAG_BYTES) throw new Error("texto cifrado malformado");
  const version = blob[0];
  const key = keys[version];
  if (!key) throw new Error(`chave de cifra versão ${version} indisponível`);
  const nonce = blob.subarray(1, 1 + NONCE_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const ct = blob.subarray(1 + NONCE_BYTES, blob.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export function hmacSha256(key: Buffer, data: Buffer | string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

export function keyFromBase64(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("chave precisa ter 32 bytes em base64");
  return key;
}
