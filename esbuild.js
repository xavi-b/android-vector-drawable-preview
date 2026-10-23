const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");
const tests = process.argv.includes("--test");
const gallery = process.argv.includes("--gallery");

async function buildExtension() {
  const options = {
    entryPoints: ["src/extension.ts"],
    bundle: true,
    outfile: "dist/extension.js",
    external: ["vscode"],
    format: "cjs",
    platform: "node",
    sourcemap: true,
    target: "node18",
    logLevel: "info",
  };

  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    return;
  }

  await esbuild.build(options);
}

async function buildTests() {
  await esbuild.build({
    entryPoints: [
      "src/pathTrim.test.ts",
      "src/renderVectorDrawable.test.ts",
      "src/resources.test.ts",
    ],
    bundle: true,
    outdir: "dist",
    format: "cjs",
    platform: "node",
    sourcemap: true,
    target: "node18",
    logLevel: "info",
  });
}

async function buildGallery() {
  await esbuild.build({
    entryPoints: ["src/gallery.ts"],
    bundle: true,
    outfile: "dist/gallery.js",
    format: "cjs",
    platform: "node",
    target: "node18",
    logLevel: "info",
  });
}

async function main() {
  if (tests) {
    await buildTests();
    return;
  }
  if (gallery) {
    await buildGallery();
    return;
  }
  await buildExtension();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
