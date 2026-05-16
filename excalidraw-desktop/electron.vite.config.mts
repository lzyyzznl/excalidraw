import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/main",
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, "electron/main.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/preload",
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, "electron/preload.ts"),
        },
      },
    },
  },
  renderer: {
    root: "src",
    build: {
      outDir: "dist/renderer",
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, "src/index.html"),
        },
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
  },
});
