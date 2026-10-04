-- 社交链接的「点击弹出图片」：微信/QQ 这类没有公开主页的平台，改放二维码图片。
-- 带默认值 ''，等于不改变现状；存量链接仍按 url 跳转，加列不影响既有行为。
ALTER TABLE "SocialLink" ADD COLUMN "popupImage" TEXT NOT NULL DEFAULT '';
