/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "thismagiccarddoesnotexist3",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
      providers: {
        aws: { region: "us-east-1" },
      },
    };
  },
  async run() {
    const table = new sst.aws.Dynamo("CardsTable", {
      fields: {
        id: "string",
        dummyHashKey: "number",
        sequenceNumber: "number",
      },
      primaryIndex: { hashKey: "id" },
      globalIndexes: {
        SequenceNumberIndex: {
          hashKey: "dummyHashKey",
          rangeKey: "sequenceNumber",
        },
      },
    });

    const bucket = new sst.aws.Bucket("CardAssets", {
      public: true,
    });

    const fn = new sst.aws.Function("Api", {
      handler: "handler.handler",
      runtime: "nodejs22.x",
      memory: "2048 MB",
      timeout: "120 seconds",
      architecture: "arm64",
      streaming: true,
      url: { authorization: "none", cors: true },
      link: [table, bucket],
      environment: {
        DYNAMODB_TABLE: table.name,
        S3_BUCKET: bucket.name,
        LLM_PROVIDER: process.env.LLM_PROVIDER ?? "groq",
        GROQ_API_KEY: process.env.GROQ_API_KEY ?? "",
        GROQ_MODEL: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
        CEREBRAS_API_KEY: process.env.CEREBRAS_API_KEY ?? "",
        REPLICATE_API_TOKEN: process.env.REPLICATE_API_TOKEN ?? "",
        IS_DEBUG: process.env.IS_DEBUG ?? "false",
      },
      nodejs: {
        install: ["@napi-rs/canvas", "@napi-rs/canvas-linux-arm64-gnu", "mtg-crucible"],
      },
      copyFiles: [
        { from: "frontend/dist", to: "frontend/dist" },
      ],
    });

    // CloudFront router fronts the Lambda URL with our custom domain. SST
    // detects the Route 53 hosted zone for thismagiccarddoesnotexist.com,
    // creates the ACM cert in us-east-1, and wires the A/AAAA records.
    // www. → apex redirect not wired yet — Heroku's CloudFront still holds
    // the www CNAME claim cross-account; restore `redirects: [...]` here
    // once that's released.
    // NOTE: route pattern is `/` not `/*` — SST's router CloudFront Function
    // path matcher does a literal startsWith on `/*` which never matches a
    // real URI; `/` hits a special catch-all branch and works.
    const router = new sst.aws.Router("Router", {
      domain: "thismagiccarddoesnotexist.com",
    });
    router.route("/", fn.url);

    return {
      url: router.url,
      lambdaUrl: fn.url,
    };
  },
});
