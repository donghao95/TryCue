const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const db = new Database("prisma/data/trycue.db", { readonly: true });

// 数据库中的表
const dbTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations' ORDER BY name").all().map(t => t.name);

// schema.prisma 中的 model（简单解析）
const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
const modelMatches = schema.matchAll(/^model\s+(\w+)\s+{/gm);
const schemaModels = [...modelMatches].map(m => m[1]);

// Prisma model 名到表名的映射（简单处理：camelCase → snake_case）
function toTableName(modelName) {
  return modelName.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}
const schemaTables = schemaModels.map(toTableName);

console.log("=== 数据库表 (", dbTables.length, "个) ===");
console.log(dbTables.join(", "));
console.log("\n=== schema.prisma model (", schemaModels.length, "个) ===");
console.log(schemaModels.join(", "));
console.log("\n=== schema 对应的表名 ===");
console.log(schemaTables.join(", "));

console.log("\n=== 数据库有但 schema 没有的表 ===");
const onlyInDb = dbTables.filter(t => !schemaTables.includes(t));
console.log(onlyInDb.length ? onlyInDb.join(", ") : "（无）");

console.log("\n=== schema 有但数据库没有的表 ===");
const onlyInSchema = schemaTables.filter(t => !dbTables.includes(t));
console.log(onlyInSchema.length ? onlyInSchema.join(", ") : "（无）");

db.close();
