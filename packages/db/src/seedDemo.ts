import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const demoFiles = [
  "assets/demo/cover_parenting_tips.png",
  "assets/demo/cover_renovation_tips.png",
  "assets/demo/cover_general_recommendation.png"
];

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

for (const file of demoFiles) {
  const target = resolve(file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, onePixelPng);
}

console.log(`Seeded ${demoFiles.length} demo cover placeholders.`);
