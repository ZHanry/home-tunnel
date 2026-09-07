import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/__preview/reset");
});
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});
const ready = async (page, path = "/admin#connections") => {
  await page.goto(path);
  await expect(page.locator("#app-shell")).toBeVisible();
  await expect(page.locator("#view-content")).toHaveAttribute("aria-busy", "false");
};

test("public home and return link work without a session", async ({ page }) => {
  await page.route("**/api/v1/auth/refresh", (route) =>
    route.fulfill({ status: 401, json: { error_code: "SESSION_REVOKED" } }),
  );
  await page.goto("/");
  await expect(page.locator("#landing-screen")).toBeVisible();
  await page.goto("/admin");
  await expect(page.locator("#auth-screen")).toBeVisible();
  await page.locator(".auth-home-link").click();
  await expect(page.locator("#landing-screen")).toBeVisible();
});

test("one click switches theme and locale without translating resource names", async ({ page }) => {
  await page.route("**/api/v1/admin/connections?**", async (route) => {
    const data = await (await route.fetch()).json();
    data.items[0].name = "在线";
    await route.fulfill({ json: data });
  });
  await ready(page);
  await page.locator(".sidebar [data-theme-toggle]").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator(".sidebar [data-locale-toggle]").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator(".connection-identity h3").first()).toHaveText("在线");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#view-content")).toHaveAttribute("aria-busy", "false");
});

test("integer bandwidth is accepted and saves with a version condition", async ({ page }) => {
  await ready(page, "/admin#users");
  await page.locator('[data-action="user-policy"]').first().click();
  const input = page.locator("#modal-bandwidth_mbps");
  await input.fill("50");
  expect(await input.evaluate((el) => el.checkValidity())).toBe(true);
  await input.fill("20");
  const write = page.waitForRequest(
    (r) => r.method() === "PATCH" && r.url().includes("traffic-policies"),
  );
  await page.locator("#modal button[type=submit]").click();
  expect((await write).postDataJSON().bandwidth_limit_bps).toBe(20_000_000);
  await expect(page.locator("#modal")).not.toBeVisible();
});

test("background config events preserve input and focus", async ({ page }) => {
  await page.addInitScript(() => {
    const WS = window.WebSocket;
    window.auditSockets = [];
    window.WebSocket = class extends WS {
      constructor(...args) {
        super(...args);
        window.auditSockets.push(this);
      }
    };
  });
  await ready(page, "/admin#audit");
  await page.locator("#audit-query").fill("我的草稿");
  await page.evaluate(() =>
    window.auditSockets[0].dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify({ event: "config.version.changed" }) }),
    ),
  );
  await expect(page.locator("#sync-status")).toContainText("有新状态");
  await expect(page.locator("#audit-query")).toHaveValue("我的草稿");
  await expect(page.locator("#audit-query")).toBeFocused();
});

test("expired refresh returns to login", async ({ page }) => {
  await ready(page);
  await page.route("**/api/v1/admin/users", (route) =>
    route.fulfill({ status: 401, json: { error_code: "SESSION_REVOKED" } }),
  );
  await page.route("**/api/v1/auth/refresh", (route) =>
    route.fulfill({ status: 401, json: { error_code: "SESSION_REVOKED" } }),
  );
  await page.locator('[data-view="users"]').click();
  await expect(page.locator("#auth-screen")).toBeVisible();
  await expect(page.locator("#app-shell")).not.toBeVisible();
});

test("failed setting writes show feedback, preserve values and prevent double submit", async ({
  page,
}) => {
  await ready(page, "/admin#settings");
  let writes = 0;
  await page.route("**/api/v1/admin/settings", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    writes++;
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill({
      status: 500,
      json: { error_code: "INTERNAL_ERROR", message: "保存失败，请重试" },
    });
  });
  await page.locator("#prefix-policy").selectOption("enforce");
  await page.locator("#settings-form button").click();
  await expect(page.locator("#settings-form button")).toBeDisabled();
  await expect(page.locator("#toast-region")).toContainText("保存失败");
  await expect(page.locator("#prefix-policy")).toHaveValue("enforce");
  expect(writes).toBe(1);
});

test("unknown backup and degraded queue are never called normal", async ({ page }) => {
  await page.route("**/api/v1/admin/system/health", (route) =>
    route.fulfill({
      json: {
        status: "degraded",
        components: [
          { component: "backup", status: "unknown" },
          { component: "outbox", status: "degraded", pending: 4 },
        ],
      },
    }),
  );
  await ready(page, "/admin#dashboard");
  await expect(page.locator(".health-rail-list")).toContainText("尚无备份记录");
  await expect(page.locator(".health-rail-list")).toContainText("需要处理");
});

test("creation draft survives dismissal and owner without devices cannot submit", async ({
  page,
}) => {
  await page.route("**/api/v1/admin/users", async (route) => {
    const data = await (await route.fetch()).json();
    data.items.push({
      id: "empty-owner",
      username: "empty",
      display_name: "无设备用户",
      status: "active",
    });
    await route.fulfill({ json: data });
  });
  await ready(page);
  await page.locator('[data-action="create-connection"]').click();
  await page.locator("#modal-name").fill("未提交的服务");
  await page.keyboard.press("Escape");
  await page.locator('[data-action="create-connection"]').click();
  await expect(page.locator("#modal-name")).toHaveValue("未提交的服务");
  await page.locator("#modal-user_id").selectOption("empty-owner");
  await expect(page.locator("#modal-device_id")).toHaveValue("");
  await expect(page.locator("#modal button[type=submit]")).toBeDisabled();
});

test("connection edit conflict keeps draft and permits an explicit retry", async ({ page }) => {
  await ready(page);
  await page.locator('[data-action="edit-connection"]').first().click();
  await page.locator("#modal-name").fill("我修改的名称");
  let writes = 0;
  await page.route("**/api/v1/admin/connections/*", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    if (++writes === 1)
      return route.fulfill({
        status: 409,
        json: { error_code: "VERSION_CONFLICT", message: "连接已被其他操作修改" },
      });
    await route.continue();
  });
  await page.locator("#modal button[type=submit]").click();
  await expect(page.locator("#modal-name")).toHaveValue("我修改的名称");
  await page.getByRole("button", { name: "读取最新版本并保留我的修改" }).click();
  await expect(page.locator("#modal-error")).toContainText("已读取最新版本");
  await page.locator("#modal button[type=submit]").click();
  await expect(page.locator("#modal")).not.toBeVisible();
});

for (const width of [375, 768, 1024, 1280, 1440])
  test(`connection layout fits ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await ready(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.locator('[data-action="edit-connection"]').first()).toBeVisible();
  });

test("mobile navigation contains keyboard focus", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await ready(page);
  await page.locator("#menu-button").click();
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement.closest(".sidebar")))).toBe(
      true,
    );
  }
  await page.keyboard.press("Escape");
  await expect(page.locator("#menu-button")).toBeFocused();
});

test("standard user can access account limits and edit raw targets without errors", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/v1/client/connections", async (route) => {
    const data = await (await route.fetch()).json();
    data.items[0].proxy_type = "tcp";
    data.items[0].local_port = 22;
    await route.fulfill({ json: data });
  });
  await ready(page, "/admin?role=user#connections");
  await expect(page.locator(".connection-target").first()).toContainText("tcp://");
  await page.locator('[data-action="edit-connection"]').first().click();
  await expect(page.locator("#modal")).toBeVisible();
  expect(errors).toEqual([]);
  await page.keyboard.press("Escape");
  await page.locator('[data-view="account"]').click();
  await expect(page.locator("#view-content")).toContainText("月度配额");
});

test("custom domain removal requires confirmation and cancellation sends no write", async ({
  page,
}) => {
  await ready(page);
  await page.locator(".more-actions summary").first().click();
  await page.locator('[data-action="custom-domains"]').first().click();
  await page.locator("#modal-domain").fill("nas.example.net");
  await page.locator("#modal button[type=submit]").click();
  await expect(page.locator("[data-domain-delete]")).toHaveCount(1);
  let deletes = 0;
  await page.route("**/api/v1/admin/custom-domains/*", async (route) => {
    if (route.request().method() === "DELETE") deletes++;
    await route.continue();
  });
  await page.locator("[data-domain-delete]").click();
  await expect(page.locator("[data-domain-delete]")).toHaveText("确认删除这个域名");
  expect(deletes).toBe(0);
  await page.locator("#modal-body").getByRole("button", { name: "取消", exact: true }).click();
  expect(deletes).toBe(0);
  await page.locator("[data-domain-delete]").click();
  await page.locator("[data-domain-delete]").click();
  await expect(page.locator("[data-domain-delete]")).toHaveCount(0);
  expect(deletes).toBe(1);
});

test("server field errors are shown at the input and preserve the form", async ({ page }) => {
  await ready(page, "/admin?role=user#connections");
  await page.locator('[data-action="create-connection"]').click();
  await page.locator("#modal-name").fill("家庭服务");
  await page.route("**/api/v1/client/connections", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 400,
      json: {
        error_code: "VALIDATION_ERROR",
        message: "请修改错误字段",
        field_errors: { local_port: "端口无效，请检查目标服务" },
      },
    });
  });
  await page.locator("#modal button[type=submit]").click();
  await expect(page.locator("#modal-local_port")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#modal-local_port-error")).toContainText("端口无效");
  await expect(page.locator("#modal-name")).toHaveValue("家庭服务");
});

test("same-named connections have separate drafts and retain only the user's changes", async ({
  page,
  request,
}) => {
  const fixture = await (await request.get("/api/v1/admin/connections")).json();
  fixture.items[1].name = fixture.items[0].name;
  await page.route("**/api/v1/admin/connections?**", (route) => route.fulfill({ json: fixture }));
  await ready(page);
  await page.locator('[data-action="edit-connection"]').first().click();
  await page.locator("#modal-name").fill("我正在修改的连接");
  await page.keyboard.press("Escape");
  await page.locator('[data-action="edit-connection"]').nth(1).click();
  await expect(page.locator("#modal-name")).toHaveValue(fixture.items[1].name);
  await page.keyboard.press("Escape");
  fixture.items[0].local_port = 9001;
  fixture.items[0].version++;
  await page.locator("#sync-status").click();
  await page.locator('[data-action="edit-connection"]').first().click();
  await expect(page.locator("#modal-name")).toHaveValue("我正在修改的连接");
  await expect(page.locator("#modal-local_port")).toHaveValue("9001");
});

test("nested IP errors reopen advanced settings and focus the relevant field", async ({ page }) => {
  await ready(page, "/admin?role=user#connections");
  await page.locator('[data-action="create-connection"]').click();
  await page.locator("#modal-name").fill("家庭服务");
  await page.locator(".advanced-options summary").click();
  await page.locator("#modal-access_allowlist").fill("invalid-ip");
  await page.locator(".advanced-options summary").click();
  await page.route("**/api/v1/client/connections", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 400,
      json: {
        error_code: "VALIDATION_ERROR",
        message: "请检查访问保护",
        field_errors: { "access.ip_allowlist.0": "请输入有效的 IP 或 CIDR" },
      },
    });
  });
  await page.locator("#modal button[type=submit]").click();
  await expect(page.locator("#modal-access_allowlist")).toBeFocused();
  await expect(page.locator("#modal-access_allowlist-error")).toHaveText("请输入有效的 IP 或 CIDR");
});
