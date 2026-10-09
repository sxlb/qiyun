-- 音乐侧栏的默认状态（后台「音乐设置」面板控制）
-- demo：首次访问展开示范一次后收起（保留原行为，故作为默认值）；expand：默认展开；collapse：默认收起
ALTER TABLE "Profile" ADD COLUMN "musicSidebarDefault" TEXT NOT NULL DEFAULT 'demo';
