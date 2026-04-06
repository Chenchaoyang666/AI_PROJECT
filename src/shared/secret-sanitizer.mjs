const SENSITIVE_FIELD_NAMES = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "apiKey",
  "OPENAI_API_KEY",
  "localApiKey",
  "authorization",
  "x-api-key",
]);

function looksSensitiveKey(key = "") {
  const text = String(key || "");
  if (SENSITIVE_FIELD_NAMES.has(text)) return true;
  return /(token|secret|api[-_]?key|authorization|password)/i.test(text);
}

export function maskSecret(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 8) return "*".repeat(text.length);
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

export function redactSensitiveText(value) {
  let text = String(value || "");
  if (!text) return text;

  text = text.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***");
  text = text.replace(/("?(?:access_token|refresh_token|id_token|apiKey|OPENAI_API_KEY|localApiKey|authorization|x-api-key)"?\s*[:=]\s*)"([^"]*)"/gi, '$1"***"');
  text = text.replace(/('?(?:access_token|refresh_token|id_token|apiKey|OPENAI_API_KEY|localApiKey|authorization|x-api-key)'?\s*[:=]\s*)'([^']*)'/gi, "$1'***'");
  return text;
}

export function sanitizeForLogs(value, key = "") {
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLogs(item, key));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeForLogs(entryValue, entryKey),
      ]),
    );
  }
  if (looksSensitiveKey(key)) {
    return maskSecret(value);
  }
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }
  return value;
}
