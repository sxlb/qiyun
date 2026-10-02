-- 操作日志按时间倒序查询 / 按模块+时间筛选的索引（后台日志量增长后避免全表扫描）
CREATE INDEX "OperationLog_createdAt_idx" ON "OperationLog"("createdAt");
CREATE INDEX "OperationLog_module_createdAt_idx" ON "OperationLog"("module", "createdAt");
