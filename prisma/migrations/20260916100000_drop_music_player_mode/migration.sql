-- 侧边栏浮窗播放器已下线，musicPlayerMode 列不再被代码读写，彻底移除
ALTER TABLE "Profile" DROP COLUMN "musicPlayerMode";
