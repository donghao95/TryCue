const Database = require("better-sqlite3");
try {
  const db = new Database("E:/work/TryCue/TryCue/packages/db/prisma/data/trycue.db", { readonly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'").all();
  console.log("用户表数量:", tables.length);
  console.log("表名列表:", tables.map(t => t.name).join(", "));
  const hasTestRuns = tables.some(t => t.name === "test_runs");
  console.log("test_runs 是否在 sqlite_master:", hasTestRuns);
  if (hasTestRuns) {
    try {
      const count = db.prepare("SELECT COUNT(*) as c FROM test_runs").get();
      console.log("test_runs 行数:", count.c);
    } catch (e) {
      console.log("test_runs 查询报错:", e.message);
    }
  }
  const migrations = db.prepare("SELECT migration_name FROM _prisma_migrations ORDER BY migration_name").all();
  console.log("已应用 migration:", migrations.map(m => m.migration_name).join(", "));
  db.close();
} catch (e) {
  console.log("打开数据库报错:", e.message);
}
