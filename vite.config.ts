import { defineConfig, type PluginOption } from "vite";
import { createApiMiddleware } from "./src/server/api";

function apiPlugin(): PluginOption {
  return {
    name: "gsb-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith("/api/")) {
          next();
          return;
        }
        await createApiMiddleware()(req, res, next);
      });
    }
  };
}

export default defineConfig({
  root: "src/web",
  publicDir: "../../public",
  plugins: [apiPlugin()],
  server: { host: "127.0.0.1", port: 5220, strictPort: true },
  build: { outDir: "../../dist" }
});
