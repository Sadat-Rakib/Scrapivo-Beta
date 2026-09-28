// @lovable.dev/vite-tanstack-config already includes the following - do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // Force Nitro on for Vercel / local production builds (Lovable sandbox skips this otherwise).
  nitro: { preset: "vercel" },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    // browser-whisper / transformers.js need cross-origin isolation for SAB threads
    server: {
      watch: { ignored: ['**/reports/**', '**/test-results/**', '**/playwright-report/**'] },
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "credentialless",
      },
    },
    optimizeDeps: {
      exclude: ["browser-whisper"],
    },
    build: {
      rollupOptions: {
        // playwright-core (pulled in by the browser-research adapter) lazily
        // `await import("kerberos")` for Negotiate proxy auth and guards it with
        // try/catch. It is an optional native dep we never install, so keep
        // Rollup from statically resolving it and failing the build.
        // Server-only modules (`.server.ts`, the AWS SDK, playwright) stay
        // transitively reachable from client routes: a route imports a
        // `.functions` serverFn module and Vite still emits a browser chunk for
        // every `import()` inside it. Those chunks never execute in the browser
        // (the work runs server-side behind the serverFn handler), but Vite
        // rewrites each `node:` builtin to an EMPTY `__vite-browser-external`
        // stub, and Rollup then fails the client build on any named import from
        // it ("createHash is not exported by __vite-browser-external").
        //
        // Marking them external leaves the specifier untouched in the client
        // chunks instead of substituting a stub with no exports. Nitro/Vercel
        // resolve `node:` natively for the server bundle, which is unaffected.
        external: (id: string, importer: string | undefined, isResolved: boolean) =>
          id === "kerberos" || (isResolved === false && id.startsWith("node:")),
      },
    },
  },
});
