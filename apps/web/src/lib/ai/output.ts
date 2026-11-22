/**
 * Output checks shared by every provider. A 200 that is empty, not JSON, or
 * not the requested schema is `invalid_output`, whoever sent it: Gemini's
 * schema support is looser than OpenAI strict mode, and Claude with web
 * search runs without a format constraint, so the layer validates itself.
 *
 * The layer enforces only what all three providers can be constrained to:
 * type (incl. ["x","null"]), properties, required, additionalProperties:false,
 * enum (case-insensitive, normalised to the schema's casing), const, anyOf,
 * minItems up to 1 (non-empty), and minimum/maximum on `number` (score
 * ranges). NOT enforced, because Claude's SDK strips them from the schema
 * it sends and call sites already normalise: minItems > 1, maxItems,
 * minimum/maximum on `integer`, minLength/maxLength, pattern. Failing a
 * provider over those would fail over away from a usable answer.
 */

type Schema = Record<string, unknown>;

/** Strip a ```json fence and parse; null when it is not JSON. */
export function parseJsonText(raw: string): unknown | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  if (!cleaned) return null;
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/**
 * Claude json_object (no format constraint) may wrap the object in prose.
 * Take the outermost {...} span and parse it; null if that is not JSON.
 */
export function extractJsonObject(raw: string): unknown | null {
  const direct = parseJsonText(raw);
  if (direct !== null) return direct;
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try {
    return JSON.parse(raw.slice(first, last + 1));
  } catch {
    return null;
  }
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function typeMatches(expected: string, actual: string): boolean {
  return expected === actual || (expected === 'number' && actual === 'integer');
}

/**
 * Validate and normalise. Returns the (possibly normalised) value and a list
 * of problems; empty list = valid. Enum strings that differ only in case are
 * rewritten to the schema's casing ("direct" → "DIRECT").
 */
export function normaliseAndValidate(
  value: unknown,
  schema: Schema,
  path = '$',
  errors: string[] = [],
): { value: unknown; errors: string[] } {
  if (errors.length >= 20) return { value, errors };

  if (Array.isArray(schema.anyOf)) {
    for (const variant of schema.anyOf as Schema[]) {
      const attempt = normaliseAndValidate(value, variant, path, []);
      if (attempt.errors.length === 0) return { value: attempt.value, errors };
    }
    errors.push(`${path}: matches no anyOf variant`);
    return { value, errors };
  }

  if ('const' in schema && value !== schema.const) {
    if (typeof value === 'string' && typeof schema.const === 'string' && value.toLowerCase() === schema.const.toLowerCase()) {
      return { value: schema.const, errors };
    }
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
    return { value, errors };
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => option === value)) {
    const match =
      typeof value === 'string'
        ? schema.enum.find((option) => typeof option === 'string' && option.toLowerCase() === value.trim().toLowerCase())
        : undefined;
    if (match === undefined) {
      errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
      return { value, errors };
    }
    return { value: match, errors };
  }

  const actual = typeOf(value);
  const declared = schema.type;
  const types = declared === undefined ? [] : Array.isArray(declared) ? (declared as string[]) : [declared as string];
  if (types.length > 0 && !types.some((t) => typeMatches(t, actual))) {
    errors.push(`${path}: expected ${types.join('|')}, got ${actual}`);
    return { value, errors };
  }

  if (actual === 'object') {
    const record = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    const out: Record<string, unknown> = {};
    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (!(key in record)) errors.push(`${path}.${key}: required`);
    }
    for (const [key, child] of Object.entries(record)) {
      if (properties[key]) out[key] = normaliseAndValidate(child, properties[key], `${path}.${key}`, errors).value;
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: not allowed`);
      else out[key] = child;
    }
    return { value: out, errors };
  }

  if (actual === 'array') {
    const items = value as unknown[];
    if (typeof schema.minItems === 'number' && schema.minItems >= 1 && items.length < 1) {
      errors.push(`${path}: empty array`);
    }
    const itemSchema = schema.items && typeof schema.items === 'object' ? (schema.items as Schema) : null;
    const out = itemSchema
      ? items.map((item, index) => normaliseAndValidate(item, itemSchema, `${path}[${index}]`, errors).value)
      : items;
    return { value: out, errors };
  }

  if (actual === 'number' || (actual === 'integer' && !types.includes('integer'))) {
    const num = value as number;
    if (typeof schema.minimum === 'number' && num < schema.minimum) errors.push(`${path}: below ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && num > schema.maximum) errors.push(`${path}: above ${schema.maximum}`);
  }

  return { value, errors };
}

/** Problems only (no normalisation). */
export function validateJsonSchema(value: unknown, schema: Schema): string[] {
  return normaliseAndValidate(value, schema).errors;
}
