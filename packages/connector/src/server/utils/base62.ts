const BASE62_CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function base62ToHex(base62Id: string): string {
  let value = 0n;
  for (const char of base62Id) {
    const idx = BASE62_CHARS.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base62 character: ${char}`);
    value = value * 62n + BigInt(idx);
  }
  let hex = value.toString(16);
  while (hex.length < 32) hex = "0" + hex;
  return hex;
}

export function hexToBase62(hex: string): string {
  let value = BigInt("0x" + hex);
  if (value === 0n) return "0";
  const chars: string[] = [];
  while (value > 0n) {
    chars.unshift(BASE62_CHARS[Number(value % 62n)]);
    value = value / 62n;
  }
  return chars.join("");
}
