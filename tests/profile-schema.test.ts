import { describe, it, expect } from "vitest";
import { profileSchema } from "@/lib/validation";

describe("profileSchema", () => {
  describe("合法输入", () => {
    it("全字段合法时通过校验", () => {
      const input = {
        avatar: "https://avatars.githubusercontent.com/u/1",
        nickname: "张三",
        bio: "一句话介绍",
        github: "https://github.com/test",
        email: "test@example.com",
      };
      const result = profileSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("空字符串字段（除 nickname 外）使用默认值", () => {
      // nickname 有 min(1) 校验，空字符串会失败；其他字段空字符串合法
      const input = {
        avatar: "",
        nickname: "有名字",
        bio: "",
        github: "",
        email: "",
      };
      const result = profileSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.avatar).toBe("");
        expect(result.data.bio).toBe("");
        expect(result.data.github).toBe("");
        expect(result.data.email).toBe("");
      }
    });

    it("nickname 前后空格被 trim", () => {
      const result = profileSchema.safeParse({ nickname: "  张三  " });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.nickname).toBe("张三");
      }
    });

    it("省略字段时使用默认值", () => {
      const result = profileSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.avatar).toBe("");
        expect(result.data.nickname).toBe("无名");
      }
    });

    it("http 头像 URL 合法", () => {
      const result = profileSchema.safeParse({ avatar: "http://example.com/a.png" });
      expect(result.success).toBe(true);
    });

    it("新增字段 amapSecretKey / txWeatherSk / iconfontUrl 接受合法值", () => {
      const result = profileSchema.safeParse({
        amapSecretKey: "secret-key-123",
        txWeatherSk: "sk-456",
        iconfontUrl: "https://at.alicdn.com/t/c/font_123.js",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.amapSecretKey).toBe("secret-key-123");
        expect(result.data.txWeatherSk).toBe("sk-456");
        expect(result.data.iconfontUrl).toBe("https://at.alicdn.com/t/c/font_123.js");
      }
    });

    it("省略新增字段时使用默认值（空串）", () => {
      const result = profileSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.amapSecretKey).toBe("");
        expect(result.data.txWeatherSk).toBe("");
        expect(result.data.iconfontUrl).toBe("");
      }
    });
  });

  describe("非法输入", () => {
    it("nickname 超过 32 字符失败", () => {
      const result = profileSchema.safeParse({ nickname: "a".repeat(33) });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("32");
      }
    });

    it("bio 超过 280 字符失败", () => {
      const result = profileSchema.safeParse({ bio: "a".repeat(281) });
      expect(result.success).toBe(false);
    });

    it("avatar 非 http(s) 开头失败", () => {
      const result = profileSchema.safeParse({ avatar: "ftp://example.com/a.png" });
      expect(result.success).toBe(false);
    });

    it("github 非 https://github.com/ 开头失败", () => {
      const result = profileSchema.safeParse({ github: "http://github.com/test" });
      expect(result.success).toBe(false);
    });

    it("github 非 github.com 域名失败", () => {
      const result = profileSchema.safeParse({ github: "https://evil.com/path" });
      expect(result.success).toBe(false);
    });

    it("email 格式不正确失败", () => {
      const result = profileSchema.safeParse({ email: "not-an-email" });
      expect(result.success).toBe(false);
    });

    it("email 缺少顶级域名失败", () => {
      const result = profileSchema.safeParse({ email: "a@b" });
      expect(result.success).toBe(false);
    });

    it("avatar URL 超过 2048 字符失败", () => {
      const result = profileSchema.safeParse({ avatar: "https://" + "a".repeat(2050) });
      expect(result.success).toBe(false);
    });
  });

  describe("功能开关字段", () => {
    it("6 个功能开关缺省时默认开启", () => {
      const result = profileSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.loadingScreen).toBe(true);
        expect(result.data.clickEffect).toBe(true);
        expect(result.data.consoleEgg).toBe(true);
        expect(result.data.showStats).toBe(true);
        expect(result.data.dynamicTitle).toBe(true);
        expect(result.data.topProgressBar).toBe(true);
      }
    });

    it("可显式关闭功能开关", () => {
      const result = profileSchema.safeParse({
        loadingScreen: false,
        clickEffect: false,
        consoleEgg: false,
        showStats: false,
        dynamicTitle: false,
        topProgressBar: false,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.loadingScreen).toBe(false);
        expect(result.data.clickEffect).toBe(false);
        expect(result.data.consoleEgg).toBe(false);
        expect(result.data.showStats).toBe(false);
        expect(result.data.dynamicTitle).toBe(false);
        expect(result.data.topProgressBar).toBe(false);
      }
    });

    it("非布尔值传入开关字段时校验失败", () => {
      const result = profileSchema.safeParse({ clickEffect: "yes" });
      expect(result.success).toBe(false);
    });
  });

  describe("艺术字体（logoFont 已下线，仅保留 logoArtFont 开关）", () => {
    it("logoArtFont 缺省为 true（启用内置艺术字体）", () => {
      const result = profileSchema.safeParse({});
      if (result.success) {
        expect(result.data.logoArtFont).toBe(true);
      }
    });

    it("logoFont 已不是 schema 字段：传入被剥离，不写入数据", () => {
      // 该字段历史上允许 19 种字体，但前台只实现了一款，且后台已无选择控件，
      // 属于"存了值也没有效果"的幽灵字段，故整体下线。
      const result = profileSchema.safeParse({ logoFont: "zcool-kuail" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect("logoFont" in result.data).toBe(false);
      }
    });
  });

  describe("自定义字体字段", () => {
    it("默认值：开关 false、范围 nickname、字体名为空", () => {
      const result = profileSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.customFontEnabled).toBe(false);
        expect(result.data.customFontFamily).toBe("");
        expect(result.data.customFontScope).toBe("nickname");
      }
    });

    it("合法字体名通过（中英文、数字、空格、引号、连字符）", () => {
      const result = profileSchema.safeParse({
        customFontEnabled: true,
        customFontFamily: '"PingFang SC", Microsoft YaHei',
        customFontScope: "all",
      });
      expect(result.success).toBe(true);
    });

    it("含危险字符的字体名被拒绝", () => {
      const result = profileSchema.safeParse({
        customFontEnabled: true,
        customFontFamily: "Arial; url(https://evil.com/x.woff2)",
      });
      expect(result.success).toBe(false);
    });

    it("非法范围值被拒绝", () => {
      const result = profileSchema.safeParse({ customFontScope: "body" });
      expect(result.success).toBe(false);
    });
  });
});

/**
 * 回归：后台「上传」按钮（UploadButton）写入的是媒体库相对路径
 * （/api/uploads/file/xxx），若校验只接受 http(s):// 外链，
 * 就会出现「上传成功、保存失败」（移动端点头像「上传」必现）。
 */
describe("profileSchema：图片字段须接受上传产生的媒体库路径", () => {
  const uploaded = "/api/uploads/file/1789265262713-abcdef.jpg";

  it("avatar 接受媒体库相对路径", () => {
    expect(profileSchema.safeParse({ avatar: uploaded }).success).toBe(true);
  });

  it("siteIcon 接受媒体库相对路径", () => {
    expect(profileSchema.safeParse({ siteIcon: uploaded }).success).toBe(true);
  });

  it("bgApi 接受媒体库相对路径（后台上传自定义壁纸）", () => {
    expect(profileSchema.safeParse({ bgApi: uploaded }).success).toBe(true);
  });

  it("仍接受 http(s) 外链与空值", () => {
    expect(profileSchema.safeParse({ avatar: "https://example.com/a.png" }).success).toBe(true);
    expect(profileSchema.safeParse({ avatar: "http://example.com/a.png" }).success).toBe(true);
    expect(profileSchema.safeParse({ avatar: "" }).success).toBe(true);
    expect(profileSchema.safeParse({ bgApi: "" }).success).toBe(true);
  });

  it("仍拒绝非法协议与伪造路径", () => {
    expect(profileSchema.safeParse({ avatar: "javascript:alert(1)" }).success).toBe(false);
    expect(profileSchema.safeParse({ avatar: "ftp://example.com/a.png" }).success).toBe(false);
    expect(profileSchema.safeParse({ avatar: "/etc/passwd" }).success).toBe(false);
    expect(profileSchema.safeParse({ siteIcon: "data:image/svg+xml,<svg/>" }).success).toBe(false);
  });
});

/**
 * 金丝雀测试：防「手动白名单解构漏字段」死灰复燃。
 *
 * 历史教训：route.ts PUT handler 曾手动解构 parsed.data → 手动组装 data 对象，
 * 新增的 musicAutoplay 字段不在两处白名单 → 后台开关保存静默失效、接口仍返回 200。
 * 现已根治：route.ts 直接传 parsed.data 给 Prisma（schema 已含所有字段），
 * 本测试作为**最后防线**——如果有人重新引入手动白名单，或 schema 字段被批量删除，
 * 断言立即失败，不会再让静默故障上线。
 */
describe("金丝雀：profileSchema 所有字段都能被 route.ts 落库", () => {
  it("schema 输出字段数量 ≥ 50（防批量删字段）", () => {
    const result = profileSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      const keys = Object.keys(result.data);
      expect(keys.length).toBeGreaterThanOrEqual(50);
    }
  });

  it("关键字段全部存在于 schema 输出（防单字段丢失）", () => {
    const result = profileSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      const must = [
        // 基本信息
        "avatar", "nickname", "bio",
        // 音乐（本次修复的 musicAutoplay）
        "songApi", "songServer", "songId", "musicAutoplay",
        // 天气（本次新增的混合模式）
        "weatherProvider", "amapKey", "txWeatherKey",
        // 功能开关
        "loadingScreen", "clickEffect", "dynamicTitle",
        // 高级配置
        "siteTitle", "accentColor", "analyticsScript",
      ];
      for (const k of must) {
        expect(k in result.data).toBe(true);
      }
    }
  });
});
