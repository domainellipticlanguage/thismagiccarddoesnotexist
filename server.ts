import "dotenv/config";
import { app } from "./src/app.js";

const PORT = parseInt(process.env.PORT || "3001", 10);

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
