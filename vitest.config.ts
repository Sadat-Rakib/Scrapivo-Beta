import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    // .kilo/** holds other agents' worktrees; "Promotional Videos/**" holds plain
    // Node scripts named *.test.js (no vitest suites) from the promo-film work.
    exclude: ["**/node_modules/**", "node_modules", "dist", ".vercel", ".tanstack", "freehire/**", "e2e/**", "reports/**", "local-business-finder/**", ".agents/**", ".kilo/**", "Promotional Videos/**"],
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
