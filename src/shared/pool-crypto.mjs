import crypto from "node:crypto";

function normalizeSecret(secret) {
  const text = String(secret || "").trim();
  if (!text) {
    throw new Error("POOL_CRYPTO_KEY is required.");
  }
  return crypto.createHash("sha256").update(text).digest();
}

export function encryptJson(value, secret) {
  const key = normalizeSecret(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify(
    {
      version: 1,
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    },
    null,
    2,
  );
}

export function decryptJson(serialized, secret) {
  const key = normalizeSecret(secret);
  const parsed = typeof serialized === "string" ? JSON.parse(serialized) : serialized;
  if (parsed?.version !== 1) {
    throw new Error("Unsupported encrypted pool payload version.");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(parsed.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}
