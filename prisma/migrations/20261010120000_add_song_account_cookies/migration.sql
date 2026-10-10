-- 音乐账户 Cookie（可选）：填站主自己的会员登录态，服务端取歌单与播放地址时带上，
-- 让 VIP / 无版权曲目也能正常播放（不填则只播放免费曲目，与既有行为一致）。
-- 网易云从浏览器里复制 MUSIC_U=... 整串；QQ 音乐复制 uin=...; qm_keyst=... 整串。
-- 属敏感信息：操作日志只记「已配置 / 未配置」，不写真实值。
ALTER TABLE "Profile" ADD COLUMN "songCookieNetease" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Profile" ADD COLUMN "songCookieTencent" TEXT NOT NULL DEFAULT '';
