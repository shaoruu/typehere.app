#!/usr/bin/env node

import { build } from "esbuild";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

async function buildCli() {
  try {
    await build({
      entryPoints: [join(rootDir, "cli/th.tsx")],
      bundle: true,
      platform: "node",
      target: "node18",
      outfile: join(rootDir, "dist-cli/th.js"),
      format: "esm",
      packages: "external",
      alias: {
        "react-devtools-core": join(rootDir, "scripts/react-devtools-stub.js"),
      },
    });

    const outputFile = join(rootDir, "dist-cli/th.js");
    let content = fs.readFileSync(outputFile, "utf8");
    
    if (!content.startsWith("#!/usr/bin/env node")) {
      content = "#!/usr/bin/env node\n" + content;
      fs.writeFileSync(outputFile, content, "utf8");
    }
    
    fs.chmodSync(outputFile, "755");

    console.log("✅ CLI built successfully!");
  } catch (error) {
    console.error("❌ Build failed:", error);
    process.exit(1);
  }
}

buildCli();
