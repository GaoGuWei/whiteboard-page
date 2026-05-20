import { startServer } from "./server/index.mjs";

console.warn("server.mjs is deprecated. Use `node server/index.mjs` or `pnpm run dev:api`.");
startServer();
