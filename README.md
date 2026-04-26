# Contivo

Contivo is an AI-powered marketing workspace for strategy, competitor intelligence, idea generation, content production, and publishing workflow.

## What You Get

- Brand Memory extraction and editable brand knowledge
- Market Matrices (competitive landscape charts)
- Competitor Keywords intelligence
- Products & Services intelligence (client + competitors)
- Ideation engine with framework-based generation
- Content Pipeline with manual source support
- Publishing schedule + calendar flow
- **Strategic Reports** — AI-generated PDF market intelligence reports with scatter-plot matrices, keyword intelligence, and strategic recommendations
- Admin controls for platform limits and AI model settings

## Monorepo

```text
contivo/
├── apps/
│   ├── web/   # Next.js 15 app
│   └── api/   # NestJS API + Prisma
├── packages/
│   ├── types/   # shared zod + TS types
│   └── config/  # shared config
```

## Stack

- Frontend: Next.js 15, React 18, TypeScript, Tailwind
- Backend: NestJS 10, Prisma, PostgreSQL
- AI: Gemini + OpenAI fallback
- Auth: Clerk
- Queue/Workers: BullMQ + Redis

## Quick Start

1. Install dependencies:

```bash
pnpm install
```

2. Configure env:

```bash
cp .env.example .env
```

3. Start local services (Docker):

```bash
docker compose up -d
```

This starts PostgreSQL on `localhost:5432` and Redis on `localhost:6379`.

4. Prepare DB (API workspace):

```bash
cd apps/api
pnpm prisma:generate
pnpm prisma:migrate
pnpm db:seed
```

5. Run dev:

```bash
cd /Users/farjad/Downloads/Work-Studio/Contivo
pnpm dev
```

- Web: `http://localhost:3000`
- API: `http://localhost:3001`

## Root Scripts

- `pnpm dev` run all apps
- `pnpm build` build all packages/apps
- `pnpm typecheck` run typecheck across repo
- `pnpm lint` run lint
- `pnpm format` run prettier

## Documentation Index

- [CHANGELOG.md](./CHANGELOG.md)
- [FEATURELIST.md](./FEATURELIST.md)
- [SoftwareStructure.md](./SoftwareStructure.md)
- [importantupdate.md](./importantupdate.md)
- [howtouse.md](./howtouse.md)
- [LICENSE.md](./LICENSE.md)
