import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

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
  process.loadEnvFile(path);
}

const workspaceRoot = findWorkspaceRoot();

loadEnvFileIfExists(join(workspaceRoot, ".env.local"));
loadEnvFileIfExists(join(workspaceRoot, ".env"));
