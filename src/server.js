import app from "./app.js";
import { prisma } from "./lib/prisma.js";
import "dotenv/config";

const port = process.env.PORT || 9000;

async function main() {
  await prisma.$connect();
  console.log("Connected to Neon database");

  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}

main().catch((e) => {
  console.error("Failed to start server:", e);
  process.exit(1);
});
