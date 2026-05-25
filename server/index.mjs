import { pathToFileURL } from "node:url";
import { DEFAULT_DIR, PORT } from "./config.mjs";
import { app } from "./app.mjs";

let serverInstance;

export function startServer() {
  if (serverInstance) {
    return serverInstance;
  }

  serverInstance = app.listen(PORT, "127.0.0.1", () => {
    console.log(`Teaching transcript workbench API: http://127.0.0.1:${PORT}`);
    console.log(`Default image directory: ${DEFAULT_DIR}`);
  });

  return serverInstance;
}

const entryPoint = process.argv[1] || "";
const isDirectRun = entryPoint && import.meta.url === pathToFileURL(entryPoint).href;
const isDeprecatedWrapperRun = entryPoint.endsWith("server.mjs");
const isPm2Run =
  !isDeprecatedWrapperRun &&
  (process.env.pm_id !== undefined || process.env.NODE_APP_INSTANCE !== undefined);

if (isDirectRun || isPm2Run) {
  startServer();
}
