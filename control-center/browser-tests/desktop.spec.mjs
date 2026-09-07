import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  const root = new URL("../../linux-client/internal/gui/web/", import.meta.url);
  await page.route("**/desktop-preview", async (route) =>
    route.fulfill({
      contentType: "text/html",
      body: await readFile(new URL("index.html", root), "utf8"),
    }),
  );
  await page.route("**/desktop.js", async (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: await readFile(new URL("desktop.js", root), "utf8"),
    }),
  );
  await page.route("**/local/state", (route) => route.fulfill({ json: { enrolled: false } }));
  await page.goto("/desktop-preview");
});

test("desktop login fields have names and theme uses a readable button foreground", async ({
  page,
}) => {
  for (const id of ["server", "username", "password", "new-password", "confirm-password"])
    expect(await page.locator(`#${id}`).evaluate((el) => el.labels.length)).toBe(1);
  await page.locator("#theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.locator("#login-button").evaluate((el) => getComputedStyle(el).color)).toBe(
    "rgb(15, 23, 42)",
  );
});

test("Enter submits once, shows busy state, and retains input after failure", async ({ page }) => {
  let writes = 0;
  await page.route("**/local/login", async (route) => {
    writes++;
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.fulfill({ status: 400, json: { message: "登录失败，请重试" } });
  });
  await page.locator("#server").fill("https://console.example.com");
  await page.locator("#username").fill("alice");
  await page.locator("#password").fill("temporary-password");
  await page.locator("#password").press("Enter");
  await expect(page.locator("#login-button")).toBeDisabled();
  await expect(page.locator("#login-error")).toContainText("登录失败");
  await expect(page.locator("#username")).toHaveValue("alice");
  expect(writes).toBe(1);
});

test("required password change is revealed only after the server requests it", async ({ page }) => {
  await expect(page.locator("#password-change")).not.toBeVisible();
  await page.route("**/local/login", (route) =>
    route.fulfill({
      status: 400,
      json: { message: "the account requires a password change; provide --new-password-file" },
    }),
  );
  await page.locator("#server").fill("https://console.example.com");
  await page.locator("#username").fill("alice");
  await page.locator("#password").fill("temporary-password");
  await page.locator("#login-button").click();
  await expect(page.locator("#password-change")).toBeVisible();
  await expect(page.locator("#new-password")).toBeFocused();
});

test("desktop logout failure remains visible and retryable", async ({ page }) => {
  await page.route("**/local/state", (route) =>
    route.fulfill({ json: { enrolled: true, agent_state: "Online", connections: [] } }),
  );
  await page.route("**/local/login", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/local/update", (route) => route.fulfill({ json: { newer: false } }));
  await page.locator("#server").fill("https://console.example.com");
  await page.locator("#username").fill("alice");
  await page.locator("#password").fill("temporary-password");
  await page.locator("#login-button").click();
  await expect(page.locator("#home")).toBeVisible();
  await page.route("**/local/logout", (route) =>
    route.fulfill({ status: 500, json: { message: "退出失败，请重试" } }),
  );
  page.on("dialog", (dialog) => dialog.accept());
  await page.locator("#logout").click();
  await expect(page.locator("#status")).toContainText("退出失败");
  await expect(page.locator("#logout")).toBeEnabled();
});
