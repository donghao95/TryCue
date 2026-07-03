#!/usr/bin/env node
/**
 * API Rate Limit Probe Script
 *
 * 两种模式：
 *   默认(burst):  并发池直接打，测 API 的突发承受能力
 *   --throttle:   模拟 rateLimitedFetch，按目标 RPM 间隔放请求进并发池，测真实场景
 *
 * Usage:
 *   node scripts/probe-rate-limit.mjs [--rpm 10] [--steps 4] [--concurrency 3] [--throttle]
 *
 * 会自动读取 config/llm.local.yaml，也可以通过命令行参数覆盖。
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── Parse CLI args ──
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}
const hasFlag = (name) => args.includes(`--${name}`);

const CONCURRENCY = Number(getArg("concurrency", "3"));
const THROTTLE = hasFlag("throttle");

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

// ── Simple YAML parser (good enough for llm.local.yaml) ──
// Supports up to two levels of nesting via indentation, covering:
//   models:            → obj.models
//     fast: xxx        → obj.models.fast
//   capacity:          → obj.capacity
//     shared:          → obj.capacity.shared
//       maxRpm: 60     → obj.capacity.shared.maxRpm
function parseSimpleYaml(raw) {
  const obj = {};
  let currentNested = null;
  let currentDeepNested = null;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    // Header (key with no value): starts a nesting block
    if (/^\w+:\s*$/.test(trimmed)) {
      const key = trimmed.replace(/:\s*$/, "");
      if (indent === 0) {
        currentNested = key;
        currentDeepNested = null;
        obj[currentNested] = {};
      } else if (indent >= 2 && currentNested) {
        currentDeepNested = key;
        obj[currentNested][currentDeepNested] = {};
      }
      continue;
    }
    const kvMatch = trimmed.match(/^(\w+):\s*(.+)$/);
    if (kvMatch) {
      const [, key, val] = kvMatch;
      const cleanVal = val.replace(/^["']|["']$/g, "");
      if (indent >= 4 && currentNested && currentDeepNested) {
        obj[currentNested][currentDeepNested][key] = cleanVal;
      } else if (indent >= 2 && currentNested) {
        obj[currentNested][key] = cleanVal;
      } else {
        currentNested = null;
        currentDeepNested = null;
        obj[key] = cleanVal;
      }
    }
  }
  return obj;
}

// ── Load config from llm.local.yaml ──
let llmConfig = {};
try {
  const yamlPath = resolve(projectRoot, "config/llm.local.yaml");
  const raw = readFileSync(yamlPath, "utf-8");
  llmConfig = parseSimpleYaml(raw);
  console.log(`✓ Loaded config from ${yamlPath}`);
} catch {
  console.log("⚠ Could not load config/llm.local.yaml, using CLI args only");
}

const BASE_URL = getArg("base-url", llmConfig.baseUrl || "https://api.openai.com/v1");
const API_KEY = getArg("api-key", llmConfig.apiKey || "");
const MODEL = getArg("model", llmConfig.models?.fast || "gpt-4o-mini");
const INITIAL_RPM = Number(getArg("rpm", "10"));
const STEPS = Number(getArg("steps", "4"));

if (!API_KEY) {
  console.error("✗ No API key. Set --api-key or configure config/llm.local.yaml");
  process.exit(1);
}

// ── Helpers ──
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendOne(index) {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: `Say "ok" and nothing else. Request #${index}.` }],
        max_tokens: 10,
        temperature: 0,
      }),
    });
    const elapsed = Date.now() - start;
    const status = res.status;
    let body = null;
    try { body = await res.json(); } catch {}
    return { index, status, elapsed, body };
  } catch (err) {
    return { index, status: 0, elapsed: Date.now() - start, error: err.message };
  }
}

// ── Concurrency pool (no throttle) ──
async function runBurst(batchSize, concurrency) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < batchSize) {
      const idx = i++;
      results[idx] = await sendOne(idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batchSize) }, () => worker()));
  return results;
}

// ── Throttled mode: simulates rateLimitedFetch ──
// A shared token-bucket limiter: only one request enters the "limiter" at a time,
// spaced at `intervalMs`. But the actual HTTP calls run in a concurrency pool.
async function runThrottled(batchSize, concurrency, intervalMs) {
  const results = new Array(batchSize);
  let nextAvailableAt = 0;
  let sent = 0;

  async function worker() {
    while (sent < batchSize) {
      const idx = sent++;
      // Wait for the rate limiter slot
      const now = Date.now();
      const waitMs = Math.max(0, nextAvailableAt - now);
      if (waitMs > 0) await delay(waitMs);
      nextAvailableAt = Date.now() + intervalMs;
      // Fire the request (this one occupies a pool slot)
      results[idx] = await sendOne(idx);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, batchSize) }, () => worker()));
  return results;
}

// ── Main probe ──
const modeLabel = THROTTLE ? "throttled (simulating rateLimitedFetch)" : "burst (no throttle)";
console.log(`\n🔍 Rate Limit Probe`);
console.log(`   Endpoint:    ${BASE_URL}`);
console.log(`   Model:       ${MODEL}`);
console.log(`   Concurrency: ${CONCURRENCY}`);
console.log(`   Mode:        ${modeLabel}`);
console.log(`   Steps:       ${STEPS} (starting at ${INITIAL_RPM} RPM)\n`);
console.log("─".repeat(75));
console.log(`${"Step".padEnd(5)} ${"Target RPM".padEnd(12)} ${"Sent".padEnd(6)} ${"OK".padEnd(6)} ${"429".padEnd(6)} ${"Other".padEnd(7)} ${"Actual RPM".padEnd(12)} ${"Avg Latency".padEnd(12)}`);
console.log("─".repeat(75));

const results = [];

for (let step = 0; step < STEPS; step++) {
  const targetRpm = INITIAL_RPM * (step + 1);
  const batchSize = Math.min(targetRpm, 30);
  const intervalMs = 60_000 / targetRpm;

  let ok = 0;
  let rateLimited = 0;
  let other = 0;
  let totalLatency = 0;

  const startTime = Date.now();
  const responses = THROTTLE
    ? await runThrottled(batchSize, CONCURRENCY, intervalMs)
    : await runBurst(batchSize, CONCURRENCY);
  const elapsed = Date.now() - startTime;

  for (const r of responses) {
    totalLatency += r.elapsed;
    if (r.status === 200) ok++;
    else if (r.status === 429) rateLimited++;
    else other++;
  }

  const actualRpm = Math.round((ok / elapsed) * 60_000);
  const avgLatency = Math.round(totalLatency / responses.length);
  const hit429 = rateLimited > 0;

  results.push({ step, targetRpm, batchSize, ok, rateLimited, other, actualRpm, avgLatency, hit429 });

  console.log(
    `${String(step + 1).padEnd(5)} ${String(targetRpm).padEnd(12)} ${String(batchSize).padEnd(6)} ${String(ok).padEnd(6)} ${String(rateLimited).padEnd(6)} ${String(other).padEnd(7)} ${String(actualRpm).padEnd(12)} ${String(avgLatency + "ms").padEnd(12)}`
  );

  if (hit429) {
    const first429 = responses.find((r) => r.status === 429);
    const detail = first429?.body?.error?.message || first429?.body?.message || JSON.stringify(first429?.body);
    console.log(`   ↳ 429 detail: ${detail.substring(0, 100)}`);
  }

  if (step < STEPS - 1) {
    console.log(`   ⏳ Cooling down 5s...\n`);
    await delay(5_000);
  }
}

// ── Summary ──
console.log("\n" + "═".repeat(75));
console.log("📊 Summary\n");

const first429 = results.find((r) => r.hit429);
if (first429) {
  const safe = results.filter((r) => !r.hit429).pop();
  console.log(`  ✅ Safe ceiling:  ~${safe ? safe.targetRpm : INITIAL_RPM} RPM`);
  console.log(`  ⚠️  429 starts at: ~${first429.targetRpm} RPM`);
  if (THROTTLE) {
    const configuredRpm = llmConfig?.capacity?.shared?.maxRpm ?? "unknown";
    console.log(`  💡 With --throttle mode, the rate limiter keeps you under the ceiling.`);
    console.log(`     Current capacity.shared.maxRpm=${configuredRpm} should be safe.`);
  } else {
    console.log(`  💡 Burst mode — real usage is throttled, so actual ceiling is higher.`);
    console.log(`     Run with --throttle to simulate real rateLimitedFetch behavior.`);
  }
} else {
  console.log(`  ✅ No 429s hit up to ${results[results.length - 1].targetRpm} RPM`);
}

console.log("\n  Note: This is a rough estimate. Actual limits may vary by");
console.log("  time of day, token count, and concurrent usage.\n");
