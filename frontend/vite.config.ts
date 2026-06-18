import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("three")) return "three";
          if (id.includes("gsap")) return "gsap";
          if (id.includes("antd") || id.includes("@ant-design")) return "antd";
          if (
            id.includes("react-router") ||
            id.includes("react-dom") ||
            id.includes("/react/")
          ) {
            return "vendor";
          }
        }
      }
    }
  }
});
