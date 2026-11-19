export type CsvTable = {
  headers: string[];
  rows: Record<string, string>[];
};

export type CsvTemplateKind = "packages" | "customers" | "vouchers";

export const CSV_TEMPLATES: Record<CsvTemplateKind, string> = {
  packages:
    "name,kind,price,description,duration_value,duration_unit,download_kbps,upload_kbps,burst_kbps,data_limit_mb,unlimited,fup_download_kbps,fup_upload_kbps,device_limit,simultaneous_logins,idle_timeout_sec,session_timeout_sec,mac_binding,active\r\n",
  customers:
    "full_name,phone,email,customer_type,pppoe_username,pppoe_password,package_name,package_kind,router_mac,static_ip,status,expires_at\r\n",
  vouchers:
    "code,customer_name,phone,package_name,package_kind,status,expires_at,bound_mac,used_at,used_by_mac,legacy_cash_access\r\n",
};

const MAX_CSV_CHARS = 5 * 1024 * 1024;
const MAX_CSV_ROWS = 5_000;

export function parseCsv(text: string): CsvTable {
  if (text.length > MAX_CSV_CHARS) throw new Error("CSV files must be 5 MB or smaller");

  const source = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (afterQuote && char !== "," && char !== "\n" && char !== "\r") {
      if (/\s/.test(char)) continue;
      throw new Error("CSV contains characters after a quoted field");
    }

    if (char === '"') {
      if (field.length > 0) throw new Error("CSV contains a quote inside an unquoted field");
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
      afterQuote = false;
    } else if (char === "\n" || char === "\r") {
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
      afterQuote = false;
      if (char === "\r" && source[i + 1] === "\n") i += 1;
    } else if (!/\s/.test(char) || field.length > 0) {
      field += char;
    }
  }

  if (quoted) throw new Error("CSV contains an unclosed quoted field");
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);

  if (rows.length === 0) throw new Error("CSV is empty");
  if (rows.length - 1 > MAX_CSV_ROWS)
    throw new Error(`CSV files may contain at most ${MAX_CSV_ROWS} rows`);

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  if (headers.some((header) => !header)) throw new Error("CSV column names cannot be empty");
  if (new Set(headers).size !== headers.length)
    throw new Error("CSV contains duplicate column names");

  const records = rows.slice(1).map((cells, index) => {
    if (cells.length !== headers.length) {
      throw new Error(
        `CSV row ${index + 2} has ${cells.length} values; expected ${headers.length}`,
      );
    }
    return Object.fromEntries(headers.map((header, i) => [header, cells[i].trim()]));
  });

  return { headers, rows: records };
}
