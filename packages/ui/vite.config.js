import { defineConfig, transformWithEsbuild } from "vite";
import react from "@vitejs/plugin-react-swc";
import legacy from "@vitejs/plugin-legacy";

const TARGET = "chrome69";

const devPolyfills = `
  if (typeof globalThis === "undefined") window.globalThis = window;

  if (!Promise.allSettled)
    Promise.allSettled = function (ps) {
      return Promise.all(
        ps.map(function (p) {
          return Promise.resolve(p).then(
            function (v) { return { status: "fulfilled", value: v }; },
            function (r) { return { status: "rejected", reason: r }; }
          );
        })
      );
    };

  if (!Object.fromEntries)
    Object.fromEntries = function (it) {
      var o = {};
      for (var p of it) o[p[0]] = p[1];
      return o;
    };

  if (!String.prototype.replaceAll)
    String.prototype.replaceAll = function (s, r) {
      if (s instanceof RegExp) {
        if (!s.global)
          throw new TypeError(
            "replaceAll must be called with a global RegExp"
          );
        return this.replace(s, r);
      }
      return this.split(s).join(r);
    };

  if (window.performance) {
    var _pm = performance.measure;
    var _pk = performance.mark;
    performance.measure = function () {
      try { return _pm.apply(performance, arguments); } catch (e) {}
    };
    performance.mark = function () {
      try { return _pk.apply(performance, arguments); } catch (e) {}
    };
  }
`;

function legacyDevTarget() {
  return {
    name: "legacy-dev-target",
    apply: "serve",
    enforce: "post",
    transformIndexHtml() {
      return [
        { tag: "script", children: devPolyfills, injectTo: "head-prepend" },
      ];
    },
    async transform(code, id) {
      if (
        /\.[jt]sx?(\?|$)/.test(id) ||
        id.includes("@react-refresh") ||
        id.includes("vite/dist/client")
      ) {
        const result = await transformWithEsbuild(code, id, {
          target: TARGET,
          loader: "js",
        });
        return { code: result.code, map: result.map };
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: ["chrome >= 64"],
      renderLegacyChunks: true,
      modernPolyfills: true,
    }),
    legacyDevTarget(),
  ],
  optimizeDeps: {
    esbuildOptions: {
      target: TARGET,
    },
  },
});
