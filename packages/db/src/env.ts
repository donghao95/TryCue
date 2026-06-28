import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";

function findWorkspaceRoot() {
  let current = process.cwd();
  while (true) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) return process.cwd();
    current = parent;
  }
}

function loadEnvFileIfExists(path: string) {
  if (!existsSync(path)) return;
  const values = parseEnv(readFileSync(path, "utf8"));
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const workspaceRoot = findWorkspaceRoot();

loadEnvFileIfExists(join(workspaceRoot, ".env.local"));
loadEnvFileIfExists(join(workspaceRoot, ".env"));
