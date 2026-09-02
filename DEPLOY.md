# Deploying Contivo

Both apps run on **Railway**, in the project `contivo-api`, as two services off
this one repo. Vercel is being retired; until DNS moves it still serves
`www.contivo.app`, and it is the rollback.

| Service | What it runs | Domain |
| --- | --- | --- |
| `contivo-api` | NestJS — social OAuth, publishing, the schedulers | `contivo-api-production.up.railway.app` |
| `contivo-web` | Next.js — everything else, which is most of the product | `contivo-web-production.up.railway.app` |

Neither service auto-deploys from GitHub yet, so **pushing to `main` ships
nothing**. Deploy each explicitly:

```bash
railway up --service contivo-api
railway up --service contivo-web
```

## How each service is built

`contivo-api` uses `railway.json` at the repo root.

`contivo-web` is configured through Railpack environment variables instead,
because a Railway service reads exactly one config file path and that path is
set in the dashboard rather than by the CLI. The three variables are the whole
build:

```
RAILPACK_INSTALL_CMD   pnpm install --no-frozen-lockfile --prod=false --config.node-linker=isolated
RAILPACK_BUILD_CMD     pnpm --filter @contivo/types build && pnpm --filter @contivo/web build
RAILPACK_START_CMD     pnpm --filter @contivo/web start
```

If you would rather keep this in the repo, point the service's config path at a
committed file in the Railway dashboard and delete those three variables. Do
one or the other — a config file the service is not reading is worse than no
file, which is why the earlier `railway.web.json` was removed.

## Variables that must agree across both services

Getting any of these wrong fails quietly rather than loudly, which is how each
one has already cost a debugging session:

| Variable | Why |
| --- | --- |
| `JWT_SECRET` | The web app mints the session cookie; the API's `SessionAuthGuard` verifies it. A mismatch 401s every call from the web app. |
| `CRON_SECRET` | The API's `WebCronService` calls the web app's cron routes with it. A mismatch means Autopilot and website publishing silently never run. |
| `DATABASE_URL` | Same database, obviously — but also: it must stay the **direct** Neon endpoint. Pooling exists to survive serverless; a long-running process holds one pool and does not need it. |
| `SOCIAL_TOKEN_SECRET` | Social tokens are encrypted with it. Lose it and every stored token is undecryptable and every account has to reconnect. |
| `OAUTH_STATE_SECRET` | Signs the OAuth `state` that carries `workspaceId` through the callback. |

Compare them without printing them:

```bash
for K in JWT_SECRET CRON_SECRET DATABASE_URL SOCIAL_TOKEN_SECRET OAUTH_STATE_SECRET; do
  A=$(railway variables --kv --service contivo-api | grep "^$K=" | cut -d= -f2- | shasum -a 256 | cut -c1-10)
  W=$(railway variables --kv --service contivo-web | grep "^$K=" | cut -d= -f2- | shasum -a 256 | cut -c1-10)
  [ "$A" = "$W" ] && echo "$K match" || echo "$K MISMATCH"
done
```

## Database migrations

Production is migrated, not pushed. `db push` is what made the migration
history stop describing the real schema in the first place.

```bash
cd apps/api
DATABASE_URL=<production> DIRECT_URL=<production> npx prisma migrate deploy
```

Apply the schema **before** deploying code that depends on it. The reverse
order is a live outage: a workspace page that reads a table which does not
exist yet returns 500.

## Secrets you cannot get back

`vercel env pull` returns `""` for sensitive values, so it is not a backup —
a variable reads as empty whether or not it is set. Before deleting anything
on Vercel, copy the real values out of the dashboard into a password manager.
