import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages is served from /basilisk/. A portal zip uses relative
// asset URLs so the same build works at a host root or in a subfolder.
export default defineConfig(({ command, mode }) => ({
  base: command === "serve" ? "/" : mode === "portal" ? "./" : "/basilisk/",
  plugins: [react()],
}));
