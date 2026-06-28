import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";

const out = join(process.cwd(), "outputs", "useful-waiting");
await mkdir(out, { recursive: true });
await cp("index.html", join(out, "index.html"));
await cp("src", join(out, "src"), { recursive: true });
console.log(`Built static demo in ${out}`);
