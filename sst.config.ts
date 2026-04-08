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

    const api = new sst.aws.ApiGatewayV2("HttpApi");
    api.route("$default", fn.arn);

    return {
      url: api.url,
    };
  },
});
