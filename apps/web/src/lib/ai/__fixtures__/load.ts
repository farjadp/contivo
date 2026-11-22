import { readFileSync } from 'node:fs';

export interface Fixture {
  source: string;
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

/** Read one fixture by file name; every fixture says where it came from in `source`. */
export function loadFixture(name: string): Fixture {
  return JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')) as Fixture;
}

export function fixtureHeaders(fixture: Fixture): Headers {
  return new Headers(fixture.headers ?? {});
}

/** A fetch Response built from a fixture, for stubbing global fetch. */
export function fixtureResponse(name: string): Response {
  const fixture = loadFixture(name);
  return new Response(JSON.stringify(fixture.body), {
    status: fixture.status,
    headers: { 'content-type': 'application/json', ...(fixture.headers ?? {}) },
  });
}
