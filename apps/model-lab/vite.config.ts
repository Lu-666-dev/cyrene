import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      input: {
        modelLab: path.resolve(root, "index.html"),
        pet: path.resolve(root, "pet.html"),
        settings: path.resolve(root, "settings.html")
      }
    }
  },
  server: {
    fs: {
      allow: ["../.."]
    }
  }
});
