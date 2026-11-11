import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
  server: { fs: { allow: [".."] } },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
});
