// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LoginPage from "@/app/admin/login/page";

// vi.hoisted：mock 工厂提升执行时引用同一实例
const { signInMock, pushMock, prefetchMock, replaceMock } = vi.hoisted(() => ({
  signInMock: vi.fn(),
  pushMock: vi.fn(),
  prefetchMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  signIn: signInMock,
}));

// 登录页**刻意不使用**客户端路由：跳后台走 window.location.replace（原因见页面内注释与
// 下方「跳转方式」静态断言）。这里保留 mock 只是防止将来重新引入 useRouter 时整棵渲染树炸掉。
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn(), prefetch: prefetchMock }),
}));

/** 替换 window.location：jsdom 里 location.replace 不可写，只能整体替换 */
function stubLocation() {
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...window.location, replace: replaceMock },
  });
}

/** 构造 rate-limit 接口响应（默认未锁定） */
function mockRateLimitResponse({ locked = false, remainingMinutes = 0 } = {}) {
  return {
    ok: true,
    json: async () => ({ locked, remainingMinutes }),
  } as Response;
}

function submitForm(username: string, password: string) {
  fireEvent.change(screen.getByLabelText("账号"), { target: { value: username } });
  fireEvent.change(screen.getByLabelText("密码"), { target: { value: password } });
  const form = screen.getByRole("button", { name: "登录" }).closest("form");
  fireEvent.submit(form!);
}

/** 模拟浏览器/密码管理器直接写入 DOM：不派发 React 的 change 事件（onChange 不会触发） */
function autofillForm(username: string, password: string) {
  (screen.getByLabelText("账号") as HTMLInputElement).value = username;
  (screen.getByLabelText("密码") as HTMLInputElement).value = password;
}

function submitCurrentForm() {
  fireEvent.submit(screen.getByRole("button", { name: "登录" }).closest("form")!);
}

/** 按 URL 路由的 fetch 打桩：2fa-status 与 rate-limit 返回不同结果 */
function mockFetchRouting({ requires2fa = false } = {}) {
  return vi.fn().mockImplementation((input: RequestInfo | URL) => {
    if (String(input).includes("/api/auth/2fa-status")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ requires2fa }),
      } as Response);
    }
    return Promise.resolve(mockRateLimitResponse());
  });
}

describe("LoginPage（登录页交互）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signInMock.mockReset();
    pushMock.mockReset();
    replaceMock.mockReset();
    stubLocation();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("渲染账号/密码输入框与登录按钮", () => {
    render(<LoginPage />);
    expect(screen.getByLabelText("账号")).toBeTruthy();
    expect(screen.getByLabelText("密码")).toBeTruthy();
    expect(screen.getByRole("button", { name: "登录" })).toBeTruthy();
  });

  it("账号框 autoComplete=username、密码框 autoComplete=current-password（密码管理器兼容）", () => {
    render(<LoginPage />);
    expect(screen.getByLabelText("账号").getAttribute("autocomplete")).toBe("username");
    expect(screen.getByLabelText("密码").getAttribute("autocomplete")).toBe("current-password");
  });

  it("密码可见性切换：默认隐藏，点击眼睛图标后明文显示", () => {
    render(<LoginPage />);
    const passwordInput = screen.getByLabelText("密码") as HTMLInputElement;
    expect(passwordInput.type).toBe("password");

    fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
    expect(passwordInput.type).toBe("text");
    expect(screen.getByRole("button", { name: "隐藏密码" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "隐藏密码" }));
    expect(passwordInput.type).toBe("password");
  });

  it("登录失败：清空密码框并显示表单错误提示", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockRateLimitResponse());
    signInMock.mockResolvedValue({ error: "CredentialsSignin" });

    render(<LoginPage />);
    submitForm("admin", "wrong-password");

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("账号或密码错误");
    });
    // 安全细节：失败后密码框已清空，账号保留
    expect((screen.getByLabelText("密码") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("账号") as HTMLInputElement).value).toBe("admin");
  });

  it("限流锁定：提交前拦截并提示剩余时间，不调用 signIn", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockRateLimitResponse({ locked: true, remainingMinutes: 5 })
    );

    render(<LoginPage />);
    submitForm("admin", "password");

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("请 5 分钟后再试");
    });
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("登录成功：整页跳转到后台", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockRateLimitResponse());
    signInMock.mockResolvedValue({ ok: true });

    render(<LoginPage />);
    submitForm("admin", "correct-password");

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/admin");
    });
    // 不能走客户端路由：Router Cache 里 /admin 可能存着未登录时的重定向负载
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("登录成功不依赖客户端路由（未登录时也没有预取 /admin）", () => {
    render(<LoginPage />);
    expect(prefetchMock).not.toHaveBeenCalled();
  });

  it("提交中：按钮禁用并显示『登录中...』加载态", async () => {
    // 可控 promise：保持 signIn 未完成以观察加载态
    let resolveSignIn!: (v: unknown) => void;
    signInMock.mockReturnValue(new Promise((r) => { resolveSignIn = r; }));
    global.fetch = vi.fn().mockResolvedValue(mockRateLimitResponse());

    render(<LoginPage />);
    submitForm("admin", "password");

    const submitBtn = screen.getByRole("button", { name: /登录中/ }) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    resolveSignIn({ error: "x" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "登录" })).toBeTruthy();
    });
  });

  it("自动填充未触发 onChange：仍以表单 DOM 的真实值提交（回归：反复『账号或密码错误』）", async () => {
    global.fetch = mockFetchRouting();
    signInMock.mockResolvedValue({ error: "CredentialsSignin" });

    render(<LoginPage />);
    // 密码管理器直接写 DOM，不触发 React 的 onChange——此时受控 state 仍为空
    autofillForm("admin", "autofilled-password");
    submitCurrentForm();

    await waitFor(() => expect(signInMock).toHaveBeenCalledTimes(1));
    expect(signInMock).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({ username: "admin", password: "autofilled-password" })
    );
  });

  it("凭证为空：直接提示，不发起任何网络请求", async () => {
    global.fetch = mockFetchRouting();

    render(<LoginPage />);
    submitCurrentForm();

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("请输入账号和密码");
    });
    expect(signInMock).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("自动填充的账号开启了 2FA：提交时补探并提示验证码，不调用 signIn", async () => {
    global.fetch = mockFetchRouting({ requires2fa: true });

    render(<LoginPage />);
    autofillForm("admin", "pw");
    submitCurrentForm();

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("两步验证码");
    });
    expect(signInMock).not.toHaveBeenCalled();
  });
});

/**
 * 跳转方式的静态断言。
 *
 * 这一类回归属于「不报错、但结果不对」：登录按钮转完后一直卡在登录页，手动刷新才进得去。
 * 根因是未登录时预取 /admin 只会拿到「重定向到 /admin/login」的响应，Router Cache 里
 * /admin 这个键因此存下了登录页的负载，登录后的 router.push("/admin") 复用了它。
 *
 * 运行时用例只能证明「当前实现没有调用客户端路由」，挡不住有人为了「提速」把预取加回来，
 * 所以这里直接对源码做断言，让改动者在 CI 里就看到原因。
 */
describe("登录页的跳转方式（静态断言）", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app", "admin", "login", "page.tsx"),
    "utf8"
  );
  // 先剥掉注释再断言：注释里为了解释这个坑会引用 router.push("/admin") 这类写法，
  // 直接扫全文会把「解释」当成「实现」，断言就永远过不去了
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("不在未登录时预取 /admin", () => {
    expect(code).not.toMatch(/prefetch\s*\(\s*["'`]\/admin/);
  });

  it("登录成功后用 window.location.replace 整页跳转，而不是 router.push", () => {
    expect(code).toMatch(/window\.location\.replace\("\/admin"\)/);
    expect(code).not.toMatch(/router\.push\(/);
  });

  it("不再从 next/navigation 引入 useRouter（登录页不需要客户端路由）", () => {
    expect(code).not.toMatch(/from\s+["']next\/navigation["']/);
  });
});
