import { handle } from "hono/aws-lambda";
import { app } from "./src/app.js";

export const handler = handle(app);
