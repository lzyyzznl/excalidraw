import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  root: "src",
  base: "./",
  envDir: path.resolve(__dirname, ".."),
  server: {
    port: 3000,
  },
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
  plugins: [react()],
  css: {
    preprocessorOptions: {
      scss: {},
    },
  },
  resolve: {
    alias: [
      {
        find: /^@excalidraw\/excalidraw$/,
        replacement: path.resolve(
          __dirname,
          "../packages/excalidraw/index.tsx",
        ),
      },
      {
        find: /^@excalidraw\/excalidraw\/(.*?)/,
        replacement: path.resolve(
          __dirname,
          "../packages/excalidraw/$1",
        ),
      },
      {
        find: /^@excalidraw\/element$/,
        replacement: path.resolve(
          __dirname,
          "../packages/element/src/index.ts",
        ),
      },
      {
        find: /^@excalidraw\/element\/(.*?)/,
        replacement: path.resolve(
          __dirname,
          "../packages/element/src/$1",
        ),
      },
      {
        find: /^@excalidraw\/common$/,
        replacement: path.resolve(
          __dirname,
          "../packages/common/src/index.ts",
        ),
      },
      {
        find: /^@excalidraw\/common\/(.*?)/,
        replacement: path.resolve(
          __dirname,
          "../packages/common/src/$1",
        ),
      },
      {
        find: /^@excalidraw\/math$/,
        replacement: path.resolve(
          __dirname,
          "../packages/math/src/index.ts",
        ),
      },
      {
        find: /^@excalidraw\/math\/(.*?)/,
        replacement: path.resolve(
          __dirname,
          "../packages/math/src/$1",
        ),
      },
      {
        find: /^@excalidraw\/fractional-indexing$/,
        replacement: path.resolve(
          __dirname,
          "../packages/fractional-indexing/src/index.ts",
        ),
      },
      {
        find: /^@excalidraw\/utils$/,
        replacement: path.resolve(
          __dirname,
          "../packages/utils/src/index.ts",
        ),
      },
      {
        find: /^@excalidraw\/utils\/(.*?)/,
        replacement: path.resolve(
          __dirname,
          "../packages/utils/src/$1",
        ),
      },
    ],
  },
});
