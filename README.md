# This Magic Card Does Not Exist

AI-generated Magic: The Gathering cards. Describe a card; the system designs it, generates art, and renders a high-fidelity card image in about ten seconds.

Live at **https://thismagiccarddoesnotexist.com**.

## How it works

1. **Design** — An LLM (Groq `openai/gpt-oss-120b` by default; Cerebras `qwen-3-235b` also supported) drafts the card via a structured-output schema. Supports single-face cards and multi-face layouts (transform, MDFC, split, fuse, aftermath, adventure, saga, class, leveler, battle, room, flip, prepare).
2. **Art** — Replicate `prunaai/p-image` generates each face's artwork from a prompt. `prunaai/p-image-edit` handles fine-grained edits and cross-face art correlation (e.g. front/back of a transform card sharing a scene).
3. **Render** — [`mtg-crucible`](https://www.npmjs.com/package/mtg-crucible) renders the canonical MTG card frame in WebP. (Open source — built alongside this project.)
4. **Persist** — DynamoDB stores the card record; S3 stores art and rendered images.

## Tech stack

| Layer | Stack |
|---|---|
| Backend | Express + TypeScript, Hono streaming on Lambda |
| Frontend | React 19 + Vite + Tailwind v4 |
| Card rendering | [`mtg-crucible`](https://github.com/domainellipticlanguage/mtg-crucible) |
| LLM | Groq or Cerebras (OpenAI-compatible APIs) |
| Art | Replicate (PrunaAI p-image / p-image-edit) |
| Infra | AWS Lambda + Function URL, CloudFront router, DynamoDB, S3 — orchestrated via SST v4 |

## Project layout

```
server.ts              # Local dev entry (Express on port 3001)
handler.ts             # Lambda entry (Hono streamHandle)
sst.config.ts          # SST v4 deploy config
src/
  app.ts               # Express app (API routes + static serving)
  card-generator.ts    # Pipeline: LLM → art → render → store
  llm-client.ts        # Groq/Cerebras LLM client
  art-generator.ts     # Replicate art generation
  card-renderer.ts     # crucible renderCard wrapper
  card-table.ts        # DynamoDB CRUD
  s3-storage.ts        # S3 upload/URLs
frontend/
  src/                 # React app (pages, components, api client)
```

## Prerequisites

- Node.js 22+
- AWS credentials configured (`~/.aws/credentials`) — only needed for deploy
- API keys: [Groq](https://console.groq.com/) (or [Cerebras](https://cloud.cerebras.ai/)) + [Replicate](https://replicate.com/)

## Setup

```bash
npm install
cd frontend && npm install && cd ..

cp .env.example .env
# Fill in API keys
```

## Run locally

```bash
npm run dev
```

Starts the API server (3001) and the Vite dev server (5173) in parallel — frees those ports first if anything's already on them. Open http://localhost:5173; Vite proxies `/api/*` to the API. Ctrl+C kills both.

Backend or frontend only: `npm run dev:api` / `npm run dev:web`.

Or build the frontend and serve everything from one server (matches prod):

```bash
npm run build
npm run dev:api
# Open http://localhost:3001
```

## Deploy

```bash
npm run deploy
```

Builds the frontend and runs `sst deploy --stage production`. Creates/updates:

- DynamoDB table (`CardsTable`)
- S3 bucket (`CardAssets`)
- Lambda function (`Api`) with streaming response URL
- CloudFront router with the custom domain

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `LLM_PROVIDER` | No | `groq` (default) or `cerebras` |
| `GROQ_API_KEY` | Yes* | Groq API key (\*if provider is `groq`) |
| `GROQ_MODEL` | No | Override Groq model (default: `openai/gpt-oss-120b`) |
| `CEREBRAS_API_KEY` | Yes* | Cerebras API key (\*if provider is `cerebras`) |
| `CEREBRAS_MODEL` | No | Override Cerebras model (default: `qwen-3-235b-a22b-instruct-2507`) |
| `REPLICATE_API_TOKEN` | Yes | Replicate API token |
| `DYNAMODB_TABLE` | No | Override DDB table name (SST sets this automatically when deploying) |
| `S3_BUCKET` | No | Override S3 bucket name (SST sets this automatically when deploying) |
| `PORT` | No | Local API server port (default: 3001) |

## Contact

Questions, feedback, or bug reports: **domainellipticlanguage@gmail.com**.

## License & legal

Code: see repo. *Magic: The Gathering* is a trademark of Wizards of the Coast; this is a fan project, not affiliated with or endorsed by WotC. Generated cards are not legal for any sanctioned play.
