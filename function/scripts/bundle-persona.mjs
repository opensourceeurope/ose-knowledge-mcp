import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../agent/ose-researcher.md");
const out = resolve(here, "../src/persona.generated.ts");

let md = readFileSync(src, "utf8");
// strip leading YAML frontmatter (--- ... ---)
md = md.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
// strip the SOURCE-NOTE comment block (repo-maintenance note, not persona)
md = md.replace(/<!-- SOURCE-NOTE[\s\S]*?-->\n*/, "").trim();

mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  `// GENERATED from agent/ose-researcher.md by scripts/bundle-persona.mjs — do not edit.\nexport const PERSONA = ${JSON.stringify(md)};\n`
);
console.log("Bundled persona ->", out);
