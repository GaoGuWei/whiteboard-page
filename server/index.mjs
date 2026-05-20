import { pathToFileURL } from "node:url";
import { DEFAULT_DIR, PORT } from "./config.mjs";
import { app } from "./app.mjs";

export function startServer() {
  return app.listen(PORT, "127.0.0.1", () => {
    console.log(`Teaching transcript workbench API: http://127.0.0.1:${PORT}`);
    console.log(`Default image directory: ${DEFAULT_DIR}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
