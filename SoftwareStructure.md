# Software Structure

## Repository Layout

```text
contivo/
├── apps/
│   ├── web/
│   │   ├── src/app/                # App router pages + server actions
│   │   ├── src/components/          # UI components
│   │   └── src/lib/                 # business logic, ai clients, helpers
│   └── api/
│       ├── src/modules/             # Nest feature modules
│       ├── src/common/              # shared backend utilities
│       └── prisma/                  # schema + migrations + seed
├── packages/
│   ├── types/                       # shared domain/api zod schemas
│   └── config/                      # shared lint/ts config
├── turbo.json                       # monorepo task graph
└── pnpm-workspace.yaml              # workspace config
```

## Web App Key Areas

- `src/app/actions/*`: server actions used by dashboard flows
- `src/app/(dashboard)/growth/[id]/*`: Growth Engine workspace UI
- `src/lib/gemini.ts`: AI orchestration + provider fallback logic
- `src/lib/app-settings.ts`: dynamic platform settings store

## API App Key Areas

- `src/modules/workspaces`: workspace lifecycle
- `src/modules/instant-content`: instant generation endpoints
- `src/modules/ai`: provider abstraction
- `prisma/schema.prisma`: source of truth for DB schema
