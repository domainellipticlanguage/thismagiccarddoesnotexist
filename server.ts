import "dotenv/config";
import { serve } from "@hono/node-server";
import { app } from "./src/app.js";

const PORT = parseInt(process.env.PORT || "3001", 10);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Server running at http://localhost:${info.port}`);
});
