import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/react-router")
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
