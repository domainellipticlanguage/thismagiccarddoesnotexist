# This Magic Card Does Not Exist (v3)

AI-powered Magic: The Gathering card generator.

## Tech Stack

- **Backend**: Express.js + TypeScript, runs locally with `tsx watch`
- **Frontend**: React 19 + Vite + Tailwind CSS v4
- **Card Rendering**: `mtg-crucible` (npm package)
- **LLM**: Groq or Cerebras (OpenAI-compatible) for card design
- **Art**: Replicate (PrunaAI P-Image for gen, FLUX Kontext Pro for editing)
- **Deploy**: Serverless Framework → AWS Lambda + API Gateway
- **Storage**: DynamoDB + S3

## Project Structure

```
server.ts              # Local dev entry point (Express on port 3001)
handler.ts             # Lambda entry point (serverless-http wraps Express)
serverless.yml         # Serverless Framework deploy config
src/
  app.ts               # Express app (API routes + static serving)
  card-generator.ts    # Pipeline: LLM → art → render → store
  llm-client.ts        # Groq/Cerebras LLM client (outputs crucible text)
  art-generator.ts     # Replicate art generation
  card-renderer.ts     # crucible renderCard wrapper
  card-table.ts        # DynamoDB CRUD
  s3-storage.ts        # S3 upload/URLs
  types.ts             # Shared types
frontend/
  src/                 # React app (pages, components, api client)
  dist/                # Built output (served by Express)
```

## Commands

```bash
npm run dev              # Start Express server with hot reload (port 3001)
cd frontend && npm run dev  # Start Vite dev server (port 5173, proxies /api to 3001)
npm run build            # Build frontend into frontend/dist/
npm run deploy           # Build + deploy to AWS Lambda
```

## Key Decisions

- LLM outputs crucible text format, parsed server-side with `parseCard()`
- `getArtDimensions()` called after parsing to request correct aspect ratio art
- Express serves both API and built React bundle (like Flask in v2)
- Frontend CANNOT import crucible runtime functions (they need Node/canvas)
- Frontend only imports crucible TYPES
