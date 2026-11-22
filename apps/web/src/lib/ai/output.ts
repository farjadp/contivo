/**
 * Output checks shared by every provider. A 200 that is empty, not JSON, or
 * not the requested schema is `invalid_output`, whoever sent it: Gemini's
 * schema support is looser than OpenAI strict mode, and Claude with web
 * search runs without a format constraint, so the layer validates itself.
 *
 * The validator covers the JSON Schema keywords our schemas use (type incl.
 * arrays with "null", properties, required, additionalProperties:false,
 * items, enum, const, anyOf, min/maxItems, minimum/maximum, min/maxLength,
 * pattern). Unknown keywords are ignored, never treated as failures.
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

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function typeMatches(expected: string, actual: string): boolean {
  return expected === actual || (expected === 'number' && actual === 'integer');
}

/** Returns a list of problems; empty means valid. Paths are JSON-pointer-ish. */
export function validateJsonSchema(value: unknown, schema: Schema, path = '$', errors: string[] = []): string[] {
  if (errors.length >= 20) return errors;

  if (Array.isArray(schema.anyOf)) {
    const ok = (schema.anyOf as Schema[]).some((variant) => validateJsonSchema(value, variant, path, []).length === 0);
    if (!ok) errors.push(`${path}: matches no anyOf variant`);
    return errors;
  }

  if ('const' in schema && value !== schema.const) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
    return errors;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => option === value)) {
    errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
    return errors;
  }

  const actual = typeOf(value);
  const declared = schema.type;
  if (declared !== undefined) {
    const types = Array.isArray(declared) ? (declared as string[]) : [declared as string];
    if (!types.some((t) => typeMatches(t, actual))) {
      errors.push(`${path}: expected ${types.join('|')}, got ${actual}`);
      return errors;
    }
  }

  if (actual === 'object') {
    const record = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (!(key in record)) errors.push(`${path}.${key}: required`);
    }
    for (const [key, child] of Object.entries(record)) {
      if (properties[key]) validateJsonSchema(child, properties[key], `${path}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: not allowed`);
    }
  } else if (actual === 'array') {
    const items = value as unknown[];
    if (typeof schema.minItems === 'number' && items.length < schema.minItems) {
      errors.push(`${path}: fewer than ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === 'number' && items.length > schema.maxItems) {
      errors.push(`${path}: more than ${schema.maxItems} items`);
    }
    if (schema.items && typeof schema.items === 'object') {
      items.forEach((item, index) => validateJsonSchema(item, schema.items as Schema, `${path}[${index}]`, errors));
    }
  } else if (actual === 'string') {
    const text = value as string;
    if (typeof schema.minLength === 'number' && text.length < schema.minLength) errors.push(`${path}: too short`);
    if (typeof schema.maxLength === 'number' && text.length > schema.maxLength) errors.push(`${path}: too long`);
    if (typeof schema.pattern === 'string') {
      try {
        if (!new RegExp(schema.pattern, 'u').test(text)) errors.push(`${path}: does not match pattern`);
      } catch {
        // An unparseable pattern is our schema's problem, not the model's output.
      }
    }
  } else if (actual === 'number' || actual === 'integer') {
    const num = value as number;
    if (typeof schema.minimum === 'number' && num < schema.minimum) errors.push(`${path}: below ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && num > schema.maximum) errors.push(`${path}: above ${schema.maximum}`);
  }

  return errors;
}
