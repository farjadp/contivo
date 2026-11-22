/**
 * A tiny in-memory stand-in for the Prisma calls the social module makes.
 * Supports equality, `{ in: [] }`, `{ not: x }` and `{ lte: Date }` filters,
 * `{ increment: n }` updates, a single-key `orderBy` on findFirst, and
 * `select` (ignored: whole rows are returned).
 * Not a Prisma emulator — only what the tests here exercise.
 */
type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Row[]).some((w) => matches(row, w));
    const value = row[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return (cond.in as unknown[]).includes(value);
      if ('not' in cond) return value !== cond.not;
      if ('notIn' in cond) return !(cond.notIn as unknown[]).includes(value);
      if ('lte' in cond) return value != null && value <= cond.lte;
      return false;
    }
    return value === cond;
  });
}

function applyData(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) {
      row[key] = (row[key] ?? 0) + value.increment;
    } else {
      row[key] = value;
    }
  }
  row.updatedAt = new Date();
}

let seq = 0;

/** `{ field: 'asc' | 'desc' }` only; other shapes keep insertion order. */
function sorted(rows: Row[], orderBy?: Row): Row[] {
  const [key, dir] = Object.entries(orderBy ?? {})[0] ?? [];
  if (!key || (dir !== 'asc' && dir !== 'desc')) return rows;
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => (a[key] < b[key] ? -sign : a[key] > b[key] ? sign : 0));
}

function table(rows: Row[]) {
  return {
    rows,
    async findUnique({ where }: { where: Row }) {
      return rows.find((r) => matches(r, where)) ?? null;
    },
    async findFirst({ where, orderBy }: { where?: Row; orderBy?: Row } = {}) {
      return sorted(rows, orderBy).find((r) => matches(r, where)) ?? null;
    },
    async findMany({ where }: { where?: Row } = {}) {
      return rows.filter((r) => matches(r, where));
    },
    async create({ data }: { data: Row }) {
      const row = { id: data.id ?? `row_${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    async update({ where, data }: { where: Row; data: Row }) {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error(`fake-prisma: no row for ${JSON.stringify(where)}`);
      applyData(row, data);
      return row;
    },
    async updateMany({ where, data }: { where: Row; data: Row }) {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => applyData(r, data));
      return { count: hit.length };
    },
  };
}

export function fakePrisma(seed: Partial<Record<string, Row[]>> = {}) {
  return {
    user: table(seed.user ?? []),
    workspace: table(seed.workspace ?? []),
    socialConnection: table(seed.socialConnection ?? []),
    socialPublishJob: table(seed.socialPublishJob ?? []),
    socialPublishLog: table(seed.socialPublishLog ?? []),
    contentItem: table(seed.contentItem ?? []),
    contentImage: table(seed.contentImage ?? []),
  };
}

export type FakePrisma = ReturnType<typeof fakePrisma>;
