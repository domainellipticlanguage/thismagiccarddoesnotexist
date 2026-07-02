// Resolves which DynamoDB table / S3 bucket the app talks to.
//
// In the deployed Lambda, SST injects DYNAMODB_TABLE / S3_BUCKET with the real
// (auto-generated) prod resource names, so those always win.
//
// Locally, set USE_PROD_DB=true in your .env to point a local `npm run dev` at
// the live production data instead of the local default. This is an explicit,
// opt-in switch precisely so you never hit prod by accident — and it logs a
// loud warning on startup while active. WRITES (generate / delete / supersede /
// bug-report) go straight into the real gallery when it's on. Prefer a
// read-only AWS profile if you only mean to browse.

// SST-generated production resource names (region us-east-1). Update these if
// the stack is torn down and recreated.
const PROD_TABLE = "thismagiccarddoesnotexist3-production-CardsTableTable-vtmzbzvu";
const PROD_BUCKET = "thismagiccarddoesnotexist3-production-cardassetsbucket-xvrkcsvr";

const LOCAL_DEFAULT = "thismagiccarddoesnotexist3";

/** True when the local app has been explicitly pointed at production data. */
export const usingProdDb = /^(1|true|yes)$/i.test(process.env.USE_PROD_DB ?? "");

// USE_PROD_DB is a deliberate local override, so it beats the DYNAMODB_TABLE /
// S3_BUCKET already sitting in .env (which point at the local default). The
// deployed Lambda never sets USE_PROD_DB, so there SST's injected names win.
export function tableName(): string {
  if (usingProdDb) return PROD_TABLE;
  return process.env.DYNAMODB_TABLE || LOCAL_DEFAULT;
}

export function bucketName(): string {
  if (usingProdDb) return PROD_BUCKET;
  return process.env.S3_BUCKET || LOCAL_DEFAULT;
}

if (usingProdDb) {
  console.warn(
    "\n⚠️  USE_PROD_DB is ON — this process reads AND WRITES live production data.\n" +
      `    table:  ${tableName()}\n` +
      `    bucket: ${bucketName()}\n`
  );
}
