// Tiny in-memory stand-in for the Supabase admin client: just enough of the query builder
// (select / insert / update / eq / in / maybeSingle) for the payment flows under test.
export type Row = Record<string, unknown>;

export function makeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = { payments: [], packages: [], vouchers: [], ...seed };
  const from = (name: string) => {
    const st = {
      op: "select",
      filters: [] as ((r: Row) => boolean)[],
      patch: {} as Row,
      row: {} as Row,
      returning: false,
    };
    const run = () => {
      const rows = tables[name];
      const match = rows.filter((r) => st.filters.every((f) => f(r)));
      if (st.op === "insert") {
        rows.push({ ...st.row });
        return { data: null, error: null };
      }
      if (st.op === "update") {
        match.forEach((r) => Object.assign(r, st.patch));
        return { data: st.returning ? match.map((r) => ({ ...r })) : null, error: null };
      }
      return { data: match.map((r) => ({ ...r })), error: null };
    };
    const b = {
      select() {
        if (st.op === "update") st.returning = true;
        return b;
      },
      update(p: Row) {
        st.op = "update";
        st.patch = p;
        return b;
      },
      insert(r: Row) {
        st.op = "insert";
        st.row = r;
        return b;
      },
      eq(c: string, v: unknown) {
        st.filters.push((r) => r[c] === v);
        return b;
      },
      in(c: string, a: unknown[]) {
        st.filters.push((r) => a.includes(r[c]));
        return b;
      },
      maybeSingle() {
        const res = run();
        return Promise.resolve({ data: (res.data as Row[] | null)?.[0] ?? null, error: res.error });
      },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
        return Promise.resolve(run()).then(res, rej);
      },
    };
    return b;
  };
  return { from, tables };
}
