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
npm run dev              # Start API (3001) + Vite (5173) in parallel; frees those ports first
npm run dev:api          # Backend only
npm run dev:web          # Frontend only
npm run build            # Build frontend into frontend/dist/
npm run deploy           # Build + deploy to AWS Lambda
npm run link             # Re-symlink node_modules/mtg-crucible → ~/Projects/mtg-crucible (rerun after `npm install`)
```

## Key Decisions

- LLM outputs crucible text format, parsed server-side with `parseCard()`
- `getArtDimensions()` called after parsing to request correct aspect ratio art
- Express serves both API and built React bundle (like Flask in v2)
- Frontend CANNOT import crucible runtime functions (they need Node/canvas)
- Frontend only imports crucible TYPES

# Pet Peevs
There is never a need for you to touch the .env file. If some api keys are missing, so be it, we will receive an error and then the user can fix it. Touching .env.example is fine of course.

