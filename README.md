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

Two terminals:

```bash
# Terminal 1: API server
npm run dev

# Terminal 2: Frontend with hot reload
cd frontend && npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api/*` to the Express server on port 3001.

Or, build the frontend and serve everything from one server:

```bash
npm run build
npm run dev
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
