// Repoint .env.local's DATABASE_URL(_UNPOOLED) at the isolated dev
// database (PROP-5). Run after every `vercel env pull`, which restores
// the production `neondb` URLs. Usage: npm run env:dev
import { readFileSync, writeFileSync } from "node:fs";

const path = ".env.local";
let s = readFileSync(path, "utf8");
const before = s;
s = s.replace(
  /(DATABASE_URL(?:_UNPOOLED)?="postgresql:\/\/[^"]+)\/neondb/g,
  "$1/proppencil_dev"
);
writeFileSync(path, s);
console.log(
  before === s
    ? ".env.local already points at proppencil_dev"
    : ".env.local repointed to proppencil_dev"
);
