/**
 * Convert a decimal/scientific-notation value into (digits, scale) form.
 * - digits: base-10 integer digits without a decimal point (no leading sign)
 * - scale: how many digits are after the decimal point
 *
 * Supports: number | string | bigint
 */
function normalizeDecimal(input) {
  if (typeof input === "bigint") {
    return { sign: input < 0n ? -1 : 1, digits: (input < 0n ? -input : input).toString(), scale: 0 };
  }

  const raw = typeof input === "number" ? input.toString() : String(input);
  const str = raw.trim();
  if (!str) throw new TypeError("Invalid decimal: empty");

  let sign = 1;
  let s = str;
  if (s[0] === "+") s = s.slice(1);
  else if (s[0] === "-") {
    sign = -1;
    s = s.slice(1);
  }

  // Split exponent (scientific notation).
  let exp = 0;
  const eIndex = s.search(/e/i);
  if (eIndex !== -1) {
    const expPart = s.slice(eIndex + 1);
    s = s.slice(0, eIndex);
    if (!/^[+-]?\d+$/.test(expPart)) throw new TypeError(`Invalid decimal exponent: ${raw}`);
    exp = Number(expPart);
    if (!Number.isFinite(exp)) throw new TypeError(`Invalid decimal exponent: ${raw}`);
  }

  // Validate base part (decimal notation).
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) throw new TypeError(`Invalid decimal: ${raw}`);

  const dot = s.indexOf(".");
  let digits = "";
  let scale = 0;
  if (dot === -1) {
    digits = s;
    scale = 0;
  } else {
    const intPart = s.slice(0, dot) || "0";
    const fracPart = s.slice(dot + 1);
    digits = intPart + fracPart;
    scale = fracPart.length;
  }

  // Remove leading zeros in digits (keep at least one).
  digits = digits.replace(/^0+(?=\d)/, "");
  if (digits === "") digits = "0";

  // Apply exponent: value = digits * 10^(-scale) * 10^exp => digits * 10^(exp-scale)
  const power = exp - scale;
  if (power >= 0) {
    digits = digits + "0".repeat(power);
    scale = 0;
  } else {
    scale = -power;
  }

  // Normalize -0 to +0
  if (digits === "0") sign = 1;

  return { sign, digits, scale };
}

function formatScaledInteger({ sign, digits, scale }, { trimTrailingZeros = true } = {}) {
  let s = digits;
  if (scale > 0) {
    if (s.length <= scale) s = "0".repeat(scale - s.length + 1) + s;
    const p = s.length - scale;
    s = s.slice(0, p) + "." + s.slice(p);
  }

  // Trim leading zeros in integer part.
  if (s.includes(".")) {
    const [i, f] = s.split(".");
    const ii = i.replace(/^0+(?=\d)/, "") || "0";
    s = ii + "." + f;
  } else {
    s = s.replace(/^0+(?=\d)/, "") || "0";
  }

  if (trimTrailingZeros && s.includes(".")) {
    s = s.replace(/0+$/, "");
    s = s.replace(/\.$/, "");
  }

  if (sign < 0 && s !== "0") s = "-" + s;
  return s;
}

/**
 * 精准小数相乘（避免 0.1 * 0.2 => 0.020000000000000004）。
 *
 * @param {number|string|bigint} a
 * @param {number|string|bigint} b
 * @param {{ asString?: boolean, trimTrailingZeros?: boolean }} [options]
 * @returns {number|string}
 *
 * @example
 * decimalMul(0.1, 0.2) // 0.02
 * decimalMul("1.23e2", "0.1") // 12.3
 * decimalMul("0.0000001", "0.0000002", { asString: true }) // "0.00000000000002"
 */
function decimalMul(a, b, options) {
  const na = normalizeDecimal(a);
  const nb = normalizeDecimal(b);

  const sign = na.sign * nb.sign;
  const scale = na.scale + nb.scale;

  const ai = BigInt(na.digits);
  const bi = BigInt(nb.digits);
  const product = ai * bi;

  const str = formatScaledInteger(
    { sign, digits: product.toString(), scale },
    { trimTrailingZeros: options?.trimTrailingZeros !== false }
  );

  if (options?.asString) return str;
  return Number(str);
}

module.exports = { decimalMul };
