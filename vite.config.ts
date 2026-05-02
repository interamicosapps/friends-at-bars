import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Dev-only: lets the web app call the occupancy service on the machine that runs Vite,
    // so `Failed to fetch` is avoided when using a phone (127.0.0.1:8787 would hit the phone, not your PC).
    // Set `VITE_OCCUPANCY_API_URL=/api/occupancy` in `.env.local` and keep occupancy-service on PORT 8787.
    proxy: {
      "/api/occupancy": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/occupancy/, "") || "/",
        /**
         * When occupancy-service is not running, browsers see `500`; this makes the terminal say why.
         */
        configure: (proxy) => {
          proxy.on("error", (err: Error & { code?: string }) => {
            const msg =
              err.code === "ECONNREFUSED"
                ? "ECONNREFUSED — nothing on 127.0.0.1:8787 (start occupancy-service)."
                : err.message;
            console.error(
              `\n[Vite occupancy proxy] ${msg}\n` +
                `  Fix: cd occupancy-service → npm run dev (after .env with Redis)\n` +
                `  Or: npm run dev:with-occupancy from repo root\n`
            );
          });
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Map libraries - separate chunk for heavy map dependencies
          if (id.includes("maplibre-gl") || id.includes("react-map-gl")) {
            return "map-libs";
          }
          // React and React Router
          if (
            id.includes("react") ||
            id.includes("react-dom") ||
            id.includes("react-router")
          ) {
            return "react-vendor";
          }
          // UI libraries
          if (
            id.includes("lucide-react") ||
            id.includes("date-fns") ||
            id.includes("react-day-picker")
          ) {
            return "ui-libs";
          }
          // Supabase client
          if (id.includes("@supabase")) {
            return "supabase";
          }
          // Radix UI components
          if (id.includes("@radix-ui")) {
            return "radix-ui";
          }
        },
      },
    },
  },
});
