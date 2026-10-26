// Minimal in-memory stand-in for the supabase-js query builder, enough for the server handlers.
// It applies filters at write time (so "claim a row only if it is still pending" really is
// atomic/conditional), projects selected columns, and can inject failures.
type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string; code?: string } | null };
type Pred = (r: Row) => boolean;

export class FakeDb {
  tables: Record<string, Row[]> = {};
  /** Every statement executed, for assertions: "update payments", "select vouchers", ... */
  log: { table: string; op: string; payload?: unknown }[] = [];
  private failures: { table: string; op: string; message: string }[] = [];

  seed(table: string, rows: Row[]) {
    (this.tables[table] ??= []).push(...rows.map((r) => ({ ...r })));
    return this;
  }
  rows(table: string): Row[] {
    return this.tables[table] ?? [];
  }
  /** Make the next `op` on `table` fail with a database error. */
  failNext(table: string, op: Query["op"], message = "boom") {
    this.failures.push({ table, op, message });
  }
  takeFailure(table: string, op: string) {
    const i = this.failures.findIndex((f) => f.table === table && f.op === op);
    return i === -1 ? null : this.failures.splice(i, 1)[0];
  }
  from(table: string) {
    return new Query(this, table);
  }
}

const eqLoose = (a: unknown, b: unknown) =>
  a === b || (a != null && b != null && String(a) === String(b));

class Query implements PromiseLike<Result> {
  op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private preds: Pred[] = [];
  private payload: unknown;
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private cols = "*";
  private returning = false;
  private mode: "many" | "maybe" | "one" = "many";
  private max = Infinity;
  private orders: { col: string; asc: boolean }[] = [];

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select(cols = "*") {
    if (this.op === "select") this.cols = cols;
    else {
      this.returning = true;
      this.cols = cols;
    }
    return this;
  }
  insert(p: unknown) {
    this.op = "insert";
    this.payload = p;
    return this;
  }
  update(p: unknown) {
    this.op = "update";
    this.payload = p;
    return this;
  }
  upsert(p: unknown, o: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = "upsert";
    this.payload = p;
    this.upsertOpts = o;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }

  eq(c: string, v: unknown) {
    this.preds.push((r) => eqLoose(r[c], v));
    return this;
  }
  neq(c: string, v: unknown) {
    this.preds.push((r) => !eqLoose(r[c], v));
    return this;
  }
  in(c: string, vs: unknown[]) {
    this.preds.push((r) => vs.some((v) => eqLoose(r[c], v)));
    return this;
  }
  is(c: string, v: null) {
    this.preds.push((r) => (v === null ? r[c] == null : r[c] === v));
    return this;
  }
  not(c: string, op: string, v: unknown) {
    if (op === "is") this.preds.push((r) => (v === null ? r[c] != null : r[c] !== v));
    return this;
  }
  gte(c: string, v: unknown) {
    this.preds.push((r) => String(r[c]) >= String(v));
    return this;
  }
  gt(c: string, v: unknown) {
    this.preds.push((r) => String(r[c]) > String(v));
    return this;
  }
  lt(c: string, v: unknown) {
    this.preds.push((r) => String(r[c]) < String(v));
    return this;
  }
  lte(c: string, v: unknown) {
    this.preds.push((r) => String(r[c]) <= String(v));
    return this;
  }
  // "router_id.eq.X,router_id.is.null"
  or(expr: string) {
    const parts = expr.split(",").map((p) => {
      const [col, op, ...rest] = p.split(".");
      const val = rest.join(".");
      return (r: Row) => {
        if (op === "eq") return eqLoose(r[col], val);
        if (op === "is") return val === "null" ? r[col] == null : String(r[col]) === val;
        if (op === "gt") return String(r[col]) > val;
        return false;
      };
    });
    this.preds.push((r) => parts.some((f) => f(r)));
    return this;
  }
  order(col: string, o: { ascending?: boolean } = {}) {
    this.orders.push({ col, asc: o.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }
  single() {
    this.mode = "one";
    return this;
  }

  private project(r: Row): Row {
    if (this.cols === "*") return { ...r };
    const out: Row = {};
    for (const c of this.cols.split(",").map((s) => s.trim())) out[c] = r[c];
    return out;
  }
  private shape(rows: Row[]): Result {
    const projected = rows.map((r) => this.project(r));
    if (this.mode === "many") return { data: projected, error: null };
    if (this.mode === "maybe") {
      if (projected.length > 1)
        return { data: null, error: { message: "multiple rows returned", code: "PGRST116" } };
      return { data: projected[0] ?? null, error: null };
    }
    if (projected.length !== 1)
      return { data: null, error: { message: "expected exactly one row", code: "PGRST116" } };
    return { data: projected[0], error: null };
  }

  private run(): Result {
    const { db, table } = this;
    db.log.push({ table, op: this.op, payload: this.payload });
    const fail = db.takeFailure(table, this.op);
    if (fail) return { data: null, error: { message: fail.message } };
    const all = (db.tables[table] ??= []);
    const matches = () => all.filter((r) => this.preds.every((p) => p(r)));

    switch (this.op) {
      case "select": {
        let rows = matches();
        for (const o of [...this.orders].reverse()) {
          rows = [...rows].sort(
            (a, b) =>
              (String(a[o.col]) < String(b[o.col])
                ? -1
                : String(a[o.col]) > String(b[o.col])
                  ? 1
                  : 0) * (o.asc ? 1 : -1),
          );
        }
        return this.shape(rows.slice(0, this.max));
      }
      case "insert":
      case "upsert": {
        const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
        const created: Row[] = [];
        const keys = this.upsertOpts.onConflict?.split(",").map((s) => s.trim());
        for (const p of incoming) {
          const existing = keys
            ? all.find((r) => keys.every((k) => eqLoose(r[k], p[k])))
            : undefined;
          if (this.op === "upsert" && existing) {
            if (!this.upsertOpts.ignoreDuplicates) {
              Object.assign(existing, p);
              created.push(existing);
            }
            continue;
          }
          const row: Row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...p };
          all.push(row);
          created.push(row);
        }
        return this.returning ? this.shape(created) : { data: null, error: null };
      }
      case "update": {
        const rows = matches();
        for (const r of rows) Object.assign(r, this.payload as Row);
        return this.returning ? this.shape(rows) : { data: null, error: null };
      }
      case "delete": {
        const rows = matches();
        db.tables[table] = all.filter((r) => !rows.includes(r));
        return this.returning ? this.shape(rows) : { data: null, error: null };
      }
    }
  }

  then<R1 = Result, R2 = never>(
    ok?: ((v: Result) => R1 | PromiseLike<R1>) | null,
    bad?: ((e: unknown) => R2 | PromiseLike<R2>) | null,
  ) {
    return Promise.resolve()
      .then(() => this.run())
      .then(ok, bad);
  }
}
