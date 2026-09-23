-- 数据源精简：仅保留 NeteaseMiniPlayer v3（NeteaseCloudMusicApi）/ meting / home 项目 api 三种方案
-- 删除旧数据源字段：musicApi（直接列表）、songServerSecond/songIdSecond（备用源）
ALTER TABLE "Profile" DROP COLUMN "musicApi";
ALTER TABLE "Profile" DROP COLUMN "songServerSecond";
ALTER TABLE "Profile" DROP COLUMN "songIdSecond";
