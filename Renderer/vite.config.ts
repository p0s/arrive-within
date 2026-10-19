import { defineConfig } from "vitest/config";
import { makeShippingHTMLClassic } from "./src/shipping-html";

export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "arrive-within-classic-local-bundle",
      apply: "build",
      transformIndexHtml: {
        order: "post",
        handler: makeShippingHTMLClassic,
      },
    },
  ],
  build: {
    emptyOutDir: true,
    outDir: "dist",
    sourcemap: false,
    target: "es2022",
    rolldownOptions: {
      output: {
        codeSplitting: false,
        format: "iife",
        name: "ArriveWithinGardenRenderer",
      },
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
