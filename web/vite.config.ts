import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages serves the app under /<repo>/; locally it runs at /. Readable URLs need an absolute base.
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
  server: { fs: { allow: [".."] } },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
});
