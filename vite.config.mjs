import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8788",
    },
  },
  build: {
    outDir: "dist/ui",
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react")) {
            return "react-vendor";
          }
          if (id.includes("node_modules/@ant-design/icons")) {
            return "ant-icons";
          }
          if (id.includes("node_modules/antd/es/layout") || id.includes("node_modules/antd/es/menu") || id.includes("node_modules/antd/es/tabs")) {
            return "antd-layout";
          }
          if (id.includes("node_modules/antd/es/form") || id.includes("node_modules/antd/es/input") || id.includes("node_modules/antd/es/input-number") || id.includes("node_modules/antd/es/button") || id.includes("node_modules/antd/es/segmented")) {
            return "antd-form";
          }
          if (id.includes("node_modules/antd/es/table") || id.includes("node_modules/antd/es/card") || id.includes("node_modules/antd/es/statistic") || id.includes("node_modules/antd/es/descriptions") || id.includes("node_modules/antd/es/tag") || id.includes("node_modules/antd/es/alert") || id.includes("node_modules/antd/es/drawer")) {
            return "antd-data";
          }
        },
      },
    },
  },
});
