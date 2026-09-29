import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    cssMinify: false
  },
  server: {
    proxy: {
      "/api": {
        target: "https://bot.balticm.eu",
        changeOrigin: true,
        secure: true
      }
    }
  }
});