-- 艺术字体从"11 英文 + 7 中文"改为"18 种中英双语"：
-- 旧英文字体值已移除，统一更新为默认双语字体（站酷快乐体 zcool-kuail）
UPDATE "Profile" SET "logoFont" = 'zcool-kuail'
WHERE "logoFont" IN (
  'pacifico', 'caveat', 'dancing-script', 'great-vibes', 'satisfy',
  'shadows-into-light', 'kaushan-script', 'lobster', 'righteous',
  'yellowtail', 'sacrament'
);
