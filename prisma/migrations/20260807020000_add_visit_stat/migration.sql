-- 站点访问统计表：按日期累计 PV / UV
CREATE TABLE "VisitStat" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "date" TEXT NOT NULL,
  "pv" INTEGER NOT NULL DEFAULT 0,
  "uv" INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX "VisitStat_date_key" ON "VisitStat"("date");
