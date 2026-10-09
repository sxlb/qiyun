-- 浏览器精确定位开关（后台「天气设置 → 访客定位」控制）
-- 开启后前台请求 geolocation 授权，天气与地域标签按设备坐标产出（可精确到区），
-- 绕开「运营商 IP 登记地 ≠ 设备实际位置」的问题；默认关闭，避免首次访问被打断。
ALTER TABLE "Profile" ADD COLUMN "preciseLocation" INTEGER NOT NULL DEFAULT 0;