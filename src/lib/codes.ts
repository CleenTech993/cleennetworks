const CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function randomCode(len = 8) {
  const a = new Uint32Array(len);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => CHARS[n % CHARS.length]).join("");
}
export function addDuration(value: number | null, unit: string | null, from = new Date()) {
  const d = new Date(from);
  const v = value ?? 1;
  switch (unit) {
    case "minutes": d.setMinutes(d.getMinutes() + v); break;
    case "hours": d.setHours(d.getHours() + v); break;
    case "weeks": d.setDate(d.getDate() + 7 * v); break;
    case "months": d.setMonth(d.getMonth() + v); break;
    default: d.setDate(d.getDate() + v);
  }
  return d;
}
