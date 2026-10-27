/**
 * One-time setup: installs the three packages, generates backend/.env with
 * fresh secrets and compiles the contracts.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(title, cwd, args) {
  console.log(`\n\x1b[1m▸ ${title}\x1b[0m`);
  const result = spawnSync(npm, args, { cwd: path.join(root, cwd), stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    console.error(`\n✖ "${npm} ${args.join(" ")}" failed in ${cwd}/`);
    process.exit(result.status ?? 1);
  }
}

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 18 || (major === 18 && minor < 17)) {
  console.error(`Node.js 18.17 or newer is required (found ${process.versions.node}).`);
  process.exit(1);
}

run("Installing smart-contract tooling (Hardhat, Ganache, OpenZeppelin)", "blockchain", ["install", "--no-audit", "--no-fund"]);
run("Installing backend", "backend", ["install", "--no-audit", "--no-fund"]);
run("Installing frontend", "frontend", ["install", "--no-audit", "--no-fund"]);
run("Generating backend/.env", "backend", ["run", "--silent", "setup-env"]);
run("Compiling contracts", "blockchain", ["run", "--silent", "compile"]);

console.log(`
\x1b[32m\x1b[1m✔ Setup complete.\x1b[0m

  npm start      one command: Ganache + contracts + API + built UI   → http://localhost:4000
  npm run dev    same, with hot-reloading UI                         → http://localhost:5173
  npm test       contract, backend and frontend test suites

  The admin login was printed above and is stored in backend/.env.
`);
