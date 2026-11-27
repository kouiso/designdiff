const EMPTY_VALUE = "—";
const MAX_DECIMALS = 3;

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  // toFixed の後に Number を通して末尾の 0 を落とす。-0 も "0" に揃う。
  return String(Number(value.toFixed(MAX_DECIMALS)));
}

function isPoint(value: object): value is { x: number; y: number } {
  return "x" in value && "y" in value && typeof value.x === "number" && typeof value.y === "number";
}

function stringifyObject(value: object): string {
  try {
    return JSON.stringify(value);
  } catch {
    // 循環参照などで JSON にできない値は、空にせず型名だけ出す。
    return Object.prototype.toString.call(value);
  }
}

/** evidence の expected / actual / value を、カードに出す1行の文字列へ整える。 */
export function formatIssueValue(value: unknown): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  if (typeof value === "string") return value;
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "object") {
    if (isPoint(value)) return `${formatNumber(value.x)}, ${formatNumber(value.y)}`;
    return stringifyObject(value);
  }
  return String(value);
}
