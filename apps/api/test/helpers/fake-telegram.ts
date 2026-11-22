/**
 * A tiny local stand-in for api.telegram.org, for tests only.
 *
 * Point the client at it with TELEGRAM_API_BASE=<server.base>. Routes are
 * `/bot<token>/<method>`, like the real API. Every call is recorded; each
 * method answers from a programmable handler (default: a sensible success).
 * Multipart bodies (sendPhoto) are parsed with the platform FormData parser.
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeCall {
  method: string;
  token: string;
  /** JSON body, or the text fields of a multipart body. */
  body: Record<string, any>;
  /** Multipart file parts: field → { size, type, name }. */
  files: Record<string, { size: number; type: string; name: string }>;
  contentType: string;
}

export interface FakeReply {
  status?: number;
  body: unknown;
  delayMs?: number;
}

type Handler = (call: FakeCall, calls: FakeCall[]) => FakeReply | Promise<FakeReply>;

export interface FakeTelegram {
  base: string;
  calls: FakeCall[];
  /** Replace the handler for one method. */
  on(method: string, handler: Handler): void;
  /** Answer the next N calls of `method` with these replies, then fall back. */
  queue(method: string, ...replies: FakeReply[]): void;
  callsOf(method: string): FakeCall[];
  close(): Promise<void>;
}

export const ok = (result: unknown): FakeReply => ({ status: 200, body: { ok: true, result } });
export const fail = (status: number, description: string, parameters?: Record<string, unknown>): FakeReply => ({
  status,
  body: { ok: false, error_code: status, description, ...(parameters && { parameters }) },
});

let nextMessageId = 100;

export const BOT_ID = 777000111;
export const BOT_USERNAME = 'ContivoTestBot';

const defaults: Record<string, Handler> = {
  getMe: () => ok({ id: BOT_ID, is_bot: true, first_name: 'Contivo', username: BOT_USERNAME }),
  sendMessage: (c) => ok({ message_id: ++nextMessageId, chat: { id: Number(c.body.chat_id) }, date: 0, text: c.body.text }),
  sendPhoto: (c) => ok({ message_id: ++nextMessageId, chat: { id: Number(c.body.chat_id) }, date: 0 }),
  getChatMember: (c) =>
    ok({ status: 'administrator', user: { id: Number(c.body.user_id) }, can_post_messages: true }),
  getChat: (c) => ok({ id: Number(c.body.chat_id), type: 'channel', title: 'Test channel' }),
  setWebhook: () => ok(true),
  deleteWebhook: () => ok(true),
  getUpdates: () => ok([]),
};

export async function startFakeTelegram(): Promise<FakeTelegram> {
  const calls: FakeCall[] = [];
  const handlers: Record<string, Handler> = { ...defaults };
  const queues: Record<string, FakeReply[]> = {};

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);
    const match = /^\/bot([^/]+)\/([A-Za-z]+)$/.exec(req.url ?? '');
    if (!match) {
      res.writeHead(404).end(JSON.stringify({ ok: false, error_code: 404, description: 'Not Found' }));
      return;
    }
    const contentType = String(req.headers['content-type'] ?? '');
    const body: Record<string, any> = {};
    const files: FakeCall['files'] = {};
    if (contentType.startsWith('multipart/form-data')) {
      const form = await new Response(raw, { headers: { 'content-type': contentType } }).formData();
      for (const [key, value] of form.entries()) {
        if (typeof value === 'string') body[key] = value;
        else files[key] = { size: value.size, type: value.type, name: (value as File).name };
      }
    } else if (raw.length) {
      Object.assign(body, JSON.parse(raw.toString('utf8')));
    }
    const call: FakeCall = { method: match[2], token: match[1], body, files, contentType };
    calls.push(call);

    const queued = queues[call.method]?.shift();
    const handler = handlers[call.method];
    const reply: FakeReply = queued ?? (handler ? await handler(call, calls) : fail(404, 'Not Found: method not found'));
    if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
    if (res.destroyed) return;
    res.writeHead(reply.status ?? 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply.body));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    base: `http://127.0.0.1:${port}`,
    calls,
    on: (method, handler) => { handlers[method] = handler; },
    queue: (method, ...replies) => { (queues[method] ??= []).push(...replies); },
    callsOf: (method) => calls.filter((c) => c.method === method),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
