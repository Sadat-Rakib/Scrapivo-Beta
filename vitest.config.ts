import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    // Files run serially: the two real-Chromium suites (Playwright adapter +
    // worker adapter) each spawn real browsers and contend for GPU/ports when
    // parallel — the only full-suite failures ever observed were those two
    // colliding. Serial files keep the whole suite deterministic; in-file
    // concurrency is unaffected.
    fileParallelism: false,
    include: ["**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    // .kilo/** holds other agents' worktrees; scrapivo_handoff/** holds copied source for manual review.
    // "Promotional Videos/**" holds plain Node scripts named *.test.js (no vitest suites) from the promo-film work,
    // including a copied trace tree under docs/universal-pipeline-checkpoint.
    exclude: ["**/node_modules/**", "node_modules", "dist", ".vercel", ".tanstack", "freehire/**", "e2e/**", "reports/**", "local-business-finder/**", ".agents/**", ".kilo/**", "scrapivo_handoff/**", "**/Promotional Videos/**", "Cotly/**", "docs/universal-pipeline-checkpoint/untracked-relevant-copy/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "dist/",
        "**/*.d.ts",
        "**/*.config.*",
        "**/mockData",
        "**/test{,s}/**",
        "**/*.test.*",
      ],
    },
  },
});
