# This Magic Card Does Not Exist (v3)

AI-generated Magic: The Gathering cards.

## Prerequisites

- Node.js 22+
- AWS credentials configured (`~/.aws/credentials`)
- API keys: [Groq](https://console.groq.com/) + [Replicate](https://replicate.com/)

## Setup

```bash
# Install
npm install
cd frontend && npm install && cd ..

# Make sure mtg-crucible is built
cd ../mtg-crucible && npm run build && cd ../thismagiccarddoesnotexist3

# Configure
cp .env.example .env
# Fill in API keys
```

## Running Locally

```bash
npm run dev
```

Starts both the API server (port 3001) and the Vite dev server (port 5173) in parallel — frees the ports first if anything's already on them. Open http://localhost:5173; Vite proxies `/api/*` to the API on 3001. Ctrl+C kills both.

Backend-only or frontend-only: `npm run dev:api` / `npm run dev:web`.

Or, build the frontend and serve everything from one server (matches prod):

```bash
npm run build
npm run dev:api
# Open http://localhost:3001
```

## Deploying

```bash
npm run deploy
```

Uses Serverless Framework to deploy to AWS Lambda. Creates DynamoDB table and S3 bucket automatically.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `LLM_PROVIDER` | No | `groq` (default) or `cerebras` |
| `GROQ_API_KEY` | Yes* | Groq API key |
| `REPLICATE_API_TOKEN` | Yes | Replicate API token |
| `DYNAMODB_TABLE` | No | Table name (default: `thismagiccarddoesnotexist3`) |
| `S3_BUCKET` | No | Bucket name (default: `thismagiccarddoesnotexist3`) |
| `PORT` | No | Server port (default: 3001) |


# TODO
Improve LLM instructions.
Let LLM know to leave art description blank if no changes.
But tell it to regenerate full text format description..
Add fine grained edit screen
Allow uploading an image as a prompt for card generation
Investigate `prunaai/p-image-edit` vs FLUX Kontext for art editing
Add art description to the text mode

