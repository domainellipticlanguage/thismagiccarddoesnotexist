// One-off: generate logo candidates via the same Replicate model the app uses.
// Usage: npx tsx scripts/gen-logo.ts   (writes /tmp/logo-<name>.webp)
import "dotenv/config";
import Replicate from "replicate";
import { writeFileSync } from "fs";

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const MODEL = "black-forest-labs/flux-2-klein-4b";

// Logo-oriented prompts (no card-art "epic fantasy" suffix). Theme: a magic
// card that doesn't exist — absence / dissolving / generated.
const PROMPTS: { name: string; prompt: string }[] = [
  {
    name: "dissolve",
    prompt:
      "Minimalist flat vector app icon logo. A single glowing magic playing card dissolving into golden pixel particles along one edge. Deep black background, gold and amber palette, clean geometric emblem, centered, strong silhouette, high contrast, no text, no letters.",
  },
  {
    name: "ghost",
    prompt:
      "Minimalist flat vector app icon. The dashed glowing outline of an empty playing card — a card that does not exist. Gold on near-black, simple geometric emblem, centered, high contrast, no text, no letters.",
  },
  {
    name: "glitch",
    prompt:
      "Flat vector app icon. An ornate fantasy playing card glitching and fracturing into digital static at the edges. Gold filigree on a black background, minimal emblem, centered, strong silhouette, no text, no letters.",
  },
  {
    name: "badge",
    prompt:
      "Circular emblem app icon for a fantasy card game. An ornate playing-card-back motif in gold filigree on black, perfectly symmetrical, minimal, clean lines, centered, no text, no letters.",
  },
];

function toUrl(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    const f = output[0];
    if (typeof f === "string") return f;
    if (f && typeof (f as any).url === "function") return (f as any).url().toString();
  }
  if (output && typeof (output as any).url === "function") return (output as any).url().toString();
  throw new Error(`Unexpected output shape: ${typeof output}`);
}

async function gen(name: string, prompt: string) {
  const start = Date.now();
  const output = await replicate.run(MODEL, {
    input: { prompt, aspect_ratio: "1:1", output_megapixels: "1" },
  });
  const url = toUrl(output);
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const file = `/tmp/logo-${name}.webp`;
  writeFileSync(file, buf);
  console.log(`[${name}] ${((Date.now() - start) / 1000).toFixed(1)}s  ${(buf.length / 1024).toFixed(0)}kb  -> ${file}`);
}

(async () => {
  for (const p of PROMPTS) {
    try {
      await gen(p.name, p.prompt);
    } catch (e: any) {
      console.error(`[${p.name}] FAILED: ${e.message}`);
    }
  }
})();
