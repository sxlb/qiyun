// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LoginPage from "@/app/admin/login/page";

// vi.hoisted：mock 工厂提升执行时引用同一实例
const { signInMock, pushMock, prefetchMock } = vi.hoisted(() => ({
  signInMock: vi.fn(),
  pushMock: vi.fn(),
  prefetchMock: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  signIn: signInMock,
}));

vi.mock("next/navigation", () => ({
  // prefetch：登录页挂载时会预取后台路由（缩短点登录后的等待）
  useRouter: () => ({ push: pushMock, refresh: vi.fn(), prefetch: prefetchMock }),
}));

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

describe("LoginPage（登录页交互）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signInMock.mockReset();
    pushMock.mockReset();
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

  it("登录成功：跳转后台", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockRateLimitResponse());
    signInMock.mockResolvedValue({ ok: true });

    render(<LoginPage />);
    submitForm("admin", "correct-password");

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/admin");
    });
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
});
