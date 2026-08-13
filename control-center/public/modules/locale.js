import { state } from "./state.js?v=2.5.0-modules1";

const appShell = document.querySelector("#app-shell");

const localeStorageKey = "ht_locale";
const zhToEn = {
  "跳到主要内容": "Skip to main content",
  "产品导航": "Product navigation",
  "Home Tunnel 首页": "Home Tunnel home",
  "访问 Home Tunnel GitHub 仓库": "Visit the Home Tunnel GitHub repository",
  "GitHub 仓库": "GitHub repository",
  "登录后台": "Admin sign in",
  "自托管 · 受管 HTTP/HTTPS 隧道": "Self-hosted · Managed HTTP/HTTPS tunnels",
  "家庭私有服务，": "Private services at home,",
  "安全穿透直达": "securely accessible anywhere",
  "无需公网 IP 或路由器端口映射，为 NAS、Home Assistant 和开发服务提供独立 HTTPS 地址、集中策略与可审计访问。": "Give your NAS, Home Assistant, and development services dedicated HTTPS addresses, centralized policies, and auditable access—without a public IP or router port forwarding.",
  "选择客户端平台": "Choose a client platform",
  "Windows 图形客户端": "Windows desktop client",
  "Home Tunnel 2.5.0 Windows 图形客户端预览": "Home Tunnel 2.5.0 Windows desktop client preview",
  "Linux 客户端快速开始": "Linux client quick start",
  "Windows x64 源码": "Windows x64 source",
  "Windows 当前仅提供源码，暂无官方安装包。": "Windows is currently source-only; no official installer is available.",
  "隧道状态": "Tunnel status",
  "连接运行正常": "Connections are healthy",
  "隧道在线": "Tunnel online",
  "配置已同步，安全租约持续有效": "Configuration is synced and the secure lease is valid",
  "立即同步": "Sync now",
  "暂停隧道": "Pause tunnels",
  "连接": "Connection",
  "2 条连接": "2 connections",
  "＋ 新建连接": "+ New connection",
  "家庭 NAS": "Home NAS",
  "在线": "Online",
  "开始使用 Home Tunnel": "Get started with Home Tunnel",
  "安装受管客户端": "Install a managed client",
  "Windows 使用图形界面，Linux/macOS 作为系统服务运行。": "Use the desktop app on Windows or run the system service on Linux/macOS.",
  "创建连接": "Create connection",
  "切换至浅色主题": "Switch to light theme",
  "切换至深色主题": "Switch to dark theme",
  "填写本地地址和需要的公网子域。": "Enter the local target and the public subdomain you need.",
  "云端管理": "Central management",
  "统一查看设备、状态和访问策略。": "Manage devices, status, and access policies in one place.",
  "同一套安全边界": "One consistent security boundary",
  "按设备选择运行方式": "Choose how each device runs",
  "两种客户端都只接受控制中心签发的 HTTP/HTTPS、自定义域名与管理员授权 TCP 配置和短期租约，不提供通用 FRP 命令行。": "Both clients accept only control-center-issued HTTP/HTTPS, verified custom-domain, administrator-authorized TCP configurations, and short-lived leases; neither exposes a general-purpose FRP CLI.",
  "源码 / 实验性": "Source / Experimental",
  "登录、连接管理与实时配置通知": "Sign-in, connection management, and real-time configuration updates",
  "系统托盘、开机启动与诊断": "System tray, startup, and diagnostics",
  "设备凭据写入 Windows Credential Manager": "Device credentials stored in Windows Credential Manager",
  "查看源码构建说明": "View source build instructions",
  "Linux / macOS 无界面服务": "Linux / macOS headless service",
  "Linux / macOS 客户端安装摘要": "Linux / macOS client installation summary",
  "适合 NAS、家庭服务器和常开的 Linux/macOS 主机；支持实时配置通知，不含 GUI 与自动更新。": "Designed for NAS devices, home servers, and always-on Linux/macOS hosts, with realtime configuration notifications but no GUI or automatic updates.",
  "查看安装与运维说明": "View installation and operations guide",
  "Linux Stable · macOS headless Beta · Windows x64 Source / Experimental": "Linux Stable · macOS headless Beta · Windows x64 Source / Experimental",
  "返回 Home Tunnel 产品首页": "Back to the Home Tunnel home page",
  "登录控制中心": "Sign in to Control Center",
  "使用管理员账号继续。": "Continue with an administrator account.",
  "用户名": "Username",
  "请输入用户名": "Enter your username",
  "密码": "Password",
  "请输入密码": "Enter your password",
  "显示密码": "Show password",
  "隐藏密码": "Hide password",
  "首次登录需要修改密码": "Change your password on first sign-in",
  "完成后请使用新密码重新登录。": "Sign in again with the new password when finished.",
  "当前临时密码": "Current temporary password",
  "新密码": "New password",
  "至少 12 个字符，且不能包含用户名。": "Use at least 12 characters and do not include the username.",
  "保存新密码": "Save new password",
  "返回产品首页": "Back to product home",
  "主导航": "Main navigation",
  "控制中心 v2.5.0": "Control Center v2.5.0",
  "工作区": "Workspace",
  "系统总览": "Overview",
  "用户管理": "Users",
  "设备管理": "Devices",
  "连接管理": "Connections",
  "审计事件": "Audit events",
  "安全会话": "Secure session",
  "权限已验证": "Permissions verified",
  "管理员": "Administrator",
  "退出登录": "Sign out",
  "打开导航": "Open navigation",
  "运行状态": "Runtime status",
  "页面操作": "Page actions",
  "关闭导航": "Close navigation",
  "操作": "Action",
  "关闭对话框": "Close dialog",
  "刷新数据": "Refresh data",
  "创建用户": "Create user",
  "刷新状态": "Refresh status",
  "刷新事件": "Refresh events",
  "身份与权限": "Identity and access",
  "设备信任": "Device trust",
  "受管隧道": "Managed tunnels",
  "操作轨迹": "Activity trail",
  "无法加载数据": "Unable to load data",
  "重试": "Retry",
  "Tunnel Pulse 核心控制台": "Tunnel Pulse control console",
  "Tunnel Pulse 穿透主控": "Tunnel Pulse controller",
  "实时连接状态与 24 小时数据流转": "Live connection status and 24-hour traffic",
  "网关正常运行": "Gateway healthy",
  "在线 / 总连接": "Online / total connections",
  "以服务端运行状态为准": "Based on server runtime state",
  "24 小时传输流量": "Traffic over 24 hours",
  "系统组件健康状态": "System component health",
  "系统组件": "System components",
  "控制中心": "Control center",
  "流量网关": "Traffic gateway",
  "关键补充统计": "Additional key metrics",
  "启用账号": "Active accounts",
  "在线设备": "Online devices",
  "受管域名": "Managed domain",
  "流量最高的连接": "Top connections by traffic",
  "过去 24 小时数据传输排行": "Traffic ranking over the past 24 hours",
  "用户": "User",
  "上传": "Upload",
  "下载": "Download",
  "请求": "Requests",
  "暂无流量样本": "No traffic samples yet",
  "网关收到业务请求后会按 10 秒桶写入样本。": "The gateway writes samples in 10-second buckets after receiving traffic.",
  "角色": "Role",
  "状态": "Status",
  "设备 / 连接": "Devices / connections",
  "账号上限": "Account limit",
  "本月流量": "Traffic this month",
  "限速": "Limits",
  "重置密码": "Reset password",
  "禁用": "Disable",
  "恢复": "Restore",
  "普通用户": "Standard user",
  "还没有用户": "No users yet",
  "创建首个普通用户并将一次性临时密码安全交付给本人。": "Create the first standard user and securely deliver the one-time temporary password.",
  "设备": "Device",
  "配置": "Configuration",
  "最后在线": "Last seen",
  "租约到期": "Lease expires",
  "未知": "Unknown",
  "删除": "Delete",
  "还没有注册设备": "No registered devices yet",
  "用户可通过 Windows 图形客户端或 Linux/macOS 无界面服务完成设备注册。": "Users can register devices with the Windows desktop client or Linux/macOS headless service.",
  "归属": "Owner",
  "访问控制": "Access control",
  "本地目标": "Local target",
  "连接上限": "Connection limit",
  "版本": "Version",
  "域名": "Domains",
  "编辑": "Edit",
  "开放": "Open",
  "FRP 租约": "FRP lease",
  "还没有连接": "No connections yet",
  "为已注册设备创建 HTTP/HTTPS 连接，或由管理员开启高级 TCP 隧道。": "Create an HTTP/HTTPS connection for a registered device, or let an administrator enable an advanced TCP tunnel.",
  "关键词": "Keywords",
  "动作": "Action",
  "目标类型": "Target type",
  "每页": "Per page",
  "全部目标": "All targets",
  "重置": "Reset",
  "筛选": "Filter",
  "时间": "Time",
  "操作者": "Actor",
  "目标": "Target",
  "没有匹配的审计事件": "No matching audit events",
  "调整筛选条件后重试。": "Adjust the filters and try again.",
  "上一页": "Previous",
  "下一页": "Next",
  "取消": "Cancel",
  "保存": "Save",
  "处理中…": "Processing…",
  "正在保存…": "Saving…",
  "正在验证…": "Verifying…",
  "连接名称": "Connection name",
  "连接标识": "Connection identifier",
  "隧道类型": "Tunnel type",
  "TCP（高级）": "TCP (advanced)",
  "TCP 端口仅管理员可分配。": "Only administrators can assign TCP ports.",
  "TCP 公网端口": "Public TCP port",
  "本地协议": "Local protocol",
  "本地地址": "Local address",
  "本地端口": "Local port",
  "连接上限 (Mbps)": "Connection limit (Mbps)",
  "创建后立即启用": "Enable immediately",
  "创建受管连接": "Create managed connection",
  "受管连接": "Managed connection",
  "创建连接": "Create connection",
  "启用连接": "Enable connection",
  "版本化更新": "Versioned update",
  "DNS 所有权验证": "DNS ownership verification",
  "需要两条 DNS 记录": "Two DNS records are required",
  "先添加 TXT 所有权证明，再把域名 CNAME 到受管地址。验证成功后会自动申请证书并重配隧道。": "Add the TXT ownership proof, then CNAME the domain to the managed address. Successful verification triggers certificate issuance and tunnel reconfiguration.",
  "尚未绑定自定义域名。": "No custom domains are bound yet.",
  "新增域名": "Add domain",
  "创建验证记录": "Create verification record",
  "检查 DNS": "Check DNS",
  "等待 DNS": "Waiting for DNS",
  "已验证": "Verified",
  "需要确认": "Confirmation required",
  "确认删除": "Confirm deletion",
  "健康": "Healthy",
  "异常": "Unhealthy",
  "降级": "Degraded",
  "待确认": "Unknown",
  "正常": "Healthy",
  "待改密": "Password change required",
  "待应用": "Pending",
  "应用中": "Applying",
  "离线": "Offline",
  "已禁用": "Disabled",
  "已撤销": "Revoked",
  "启用": "Enabled",
  "配额停用": "Quota suspended",
  "不限速": "Unlimited",
  "身份管理": "Identity management",
  "显示名称": "Display name",
  "账号带宽上限 (Mbps)": "Account bandwidth limit (Mbps)",
  "留空表示不限速": "Leave blank for unlimited",
  "创建并生成临时密码": "Create and generate temporary password",
  "临时密码": "Temporary password",
  "安全交付": "Secure delivery",
  "仅显示这一次": "Shown only once",
  "复制到剪贴板": "Copy to clipboard",
  "我已安全保存": "I have saved it securely",
  "带宽与配额策略": "Bandwidth and quota policy",
  "动态共享带宽池": "Dynamic shared bandwidth pool",
  "该用户全部活跃连接共享此上限；上传和下载共同消耗。": "All active connections for this user share the limit; upload and download consume the same pool.",
  "月度流量配额": "Monthly traffic quota",
  "月度配额 (GiB)": "Monthly quota (GiB)",
  "留空表示不限配额": "Leave blank for no quota",
  "IP 白名单（每行一个 IP 或 CIDR）": "IP allowlist (one IP or CIDR per line)",
  "留空表示不限制来源。门禁在网关侧执行，保存后立即生效且不会重启隧道。": "Leave blank to allow all sources. Enforcement happens at the gateway and takes effect immediately without restarting the tunnel.",
  "Basic Auth 门禁": "Basic Auth gate",
  "关闭": "Turn off",
  "不启用": "Do not enable",
  "设置 / 重设凭据": "Set / reset credentials",
  "Basic 用户名": "Basic username",
  "Basic 口令": "Basic password",
  "1-64 字符，不能包含冒号": "1–64 characters; colon is not allowed",
  "8-128 字符；口令不会在界面回显": "8–128 characters; the password is never displayed again",
  "用户": "User",
  "设备": "Device",
  "HTTP 公网子域为": "The public HTTP subdomain is",
  "全局关闭 TCP 时，只允许停用既有 TCP 隧道或改回 HTTP。": "When TCP is globally disabled, an existing TCP tunnel can only be disabled or changed back to HTTP.",
  "例如 nas.example.com": "For example, nas.example.com",
  "验证记录已创建，请配置 DNS": "Verification record created; configure DNS",
  "域名验证成功，正在同步隧道": "Domain verified; synchronizing the tunnel",
  "自定义域名已删除": "Custom domain deleted",
  "重置临时密码": "Reset temporary password",
  "确认重置": "Confirm reset",
  "新的临时密码": "New temporary password",
  "禁用账号": "Disable account",
  "恢复账号": "Restore account",
  "确认禁用": "Confirm disable",
  "确认恢复": "Confirm restore",
  "删除设备": "Delete device",
  "删除连接": "Delete connection",
  "删除并停止": "Delete and stop",
  "连接配置已更新": "Connection configuration updated",
  "连接已创建；设备离线时保持 Pending": "Connection created; it remains pending while the device is offline",
  "连接已删除": "Connection deleted",
  "设备已删除": "Device deleted",
  "账号禁用正在收敛": "Account disable is propagating",
  "账号已恢复": "Account restored",
  "账号带宽与配额策略已更新": "Account bandwidth and quota policy updated",
  "会话已失效，请重新登录": "Your session has expired; sign in again",
  "该账号没有管理员后台权限": "This account does not have administrator access",
  "已安全退出": "Signed out securely",
  "密码已修改，请使用新密码重新登录": "Password changed; sign in again with the new password",
  "登录后台 — Home Tunnel": "Admin sign in — Home Tunnel",
  "Home Tunnel 控制中心": "Home Tunnel Control Center",
  "请求失败": "Request failed",
  "小写字母、数字、点、下划线或连字符": "Lowercase letters, numbers, dots, underscores, or hyphens",
  "临时密码 72 小时有效，首次登录后必须修改。关闭后无法再次查看。": "The temporary password is valid for 72 hours and must be changed on first sign-in. It cannot be viewed again after closing.",
  "关闭后无法再次查看；旧密码和全部旧会话已失效。": "It cannot be viewed again after closing. The old password and all previous sessions are invalid.",
  "已复制；请通过安全渠道交付": "Copied; deliver it through a secure channel",
  "浏览器未允许访问剪贴板，请手动选择并复制临时密码。": "Clipboard access was denied; select and copy the temporary password manually.",
  "请先让用户通过 Windows、Linux 或 macOS 客户端注册设备": "Ask the user to register a device with the Windows, Linux, or macOS client first",
  "动作、操作者、目标或 Request ID": "Action, actor, target, or Request ID",
  "例如 LoginSucceeded": "For example, LoginSucceeded",
  "前往 GitHub Releases 获取最新版本": "Visit GitHub Releases for the latest version",
};
const enToZh = Object.fromEntries(Object.entries(zhToEn).map(([zh, en]) => [en, zh]));

function initialLocale() {
  try {
    const stored = window.localStorage.getItem(localeStorageKey);
    if (stored === "zh-CN" || stored === "en") return stored;
  } catch {}
  return "zh-CN";
}

state.locale = initialLocale();

export function t(zh, en) {
  return state.locale === "en" ? en : zh;
}

export function localizedText(value, targetLocale = state.locale) {
  const source = String(value ?? "");
  if (!source.trim()) return source;
  const leading = source.match(/^\s*/)?.[0] ?? "";
  const trailing = source.match(/\s*$/)?.[0] ?? "";
  const core = source.slice(leading.length, source.length - trailing.length);
  let translated = targetLocale === "en" ? (zhToEn[core] ?? core) : (enToZh[core] ?? core);
  if (targetLocale === "en") {
    translated = translated
      .replace(/^显示 (\d+)–(\d+)，共 ([\d,]+) 条$/, "Showing $1–$2 of $3")
      .replace(/^第 (\d+) \/ (\d+) 页$/, "Page $1 of $2")
      .replace(/^(\d+) 条$/, "$1 items")
      .replace(/^编辑连接 · (.+)$/, "Edit connection · $1")
      .replace(/^自定义域名 · (.+)$/, "Custom domains · $1")
      .replace(/^账号带宽与配额 · (.+)$/, "Account bandwidth and quota · $1")
      .replace(/^应用 v(\d+) · 目标 v(\d+)$/, "Applied v$1 · target v$2")
      .replace(/^当前版本 v(\d+)；(.*)$/, "Current version v$1; $2")
      .replace(/^删除设备 (.+)$/, "Delete device $1");
    translated = translated
      .replace(/^(\d+) 项实时检查$/, "$1 live checks")
      .replace(/^↑ 上传 (.+) · ↓ 下载 (.+)$/, "↑ Upload $1 · ↓ Download $2");
  } else {
    translated = translated
      .replace(/^Showing (\d+)–(\d+) of ([\d,]+)$/, "显示 $1–$2，共 $3 条")
      .replace(/^Page (\d+) of (\d+)$/, "第 $1 / $2 页")
      .replace(/^(\d+) items$/, "$1 条")
      .replace(/^Edit connection · (.+)$/, "编辑连接 · $1")
      .replace(/^Custom domains · (.+)$/, "自定义域名 · $1")
      .replace(/^Account bandwidth and quota · (.+)$/, "账号带宽与配额 · $1")
      .replace(/^Applied v(\d+) · target v(\d+)$/, "应用 v$1 · 目标 v$2")
      .replace(/^Delete device (.+)$/, "删除设备 $1");
    translated = translated
      .replace(/^(\d+) live checks$/, "$1 项实时检查")
      .replace(/^↑ Upload (.+) · ↓ Download (.+)$/, "↑ 上传 $1 · ↓ 下载 $2");
  }
  return leading + translated + trailing;
}

export function localizedApiError(data, status) {
  if (state.locale !== "en") return data?.message ?? `请求失败 (${status})`;
  return {
    AUTH_INVALID: "Authentication failed",
    AUTH_REQUIRED: "Authentication is required",
    CSRF_INVALID: "The security token is invalid; refresh and try again",
    VALIDATION_ERROR: "Some fields are invalid",
    VERSION_CONFLICT: "This item was changed elsewhere; refresh and try again",
    OWNERSHIP_MISMATCH: "The requested item was not found",
    NOT_FOUND: "The requested item was not found",
    DEVICE_REVOKED: "This device has been revoked",
    DNS_VERIFICATION_FAILED: "The DNS TXT or CNAME record has not propagated yet",
    CUSTOM_DOMAIN_CONFLICT: "This domain is already bound to another connection",
    CUSTOM_DOMAIN_LIMIT: "A connection can have at most 100 custom domains",
    PROXY_TYPE_UNSUPPORTED: "This tunnel type does not support the requested operation",
    TCP_TUNNELS_DISABLED: "TCP tunnels are disabled by the administrator",
    TCP_PORT_CONFLICT: "This public TCP port is already assigned",
  }[data?.error_code] ?? `Request failed (${status})`;
}

export function translateTree(root = document, targetLocale = state.locale) {
  if (root.nodeType === Node.TEXT_NODE) {
    const translated = localizedText(root.nodeValue, targetLocale);
    if (translated !== root.nodeValue) root.nodeValue = translated;
    return;
  }
  const rootElement = root.nodeType === Node.ELEMENT_NODE ? root : root.documentElement;
  const elements = rootElement ? [rootElement, ...rootElement.querySelectorAll("*")] : [];
  for (const element of elements) {
    if (!element.matches("script,style,code")) {
      for (const attribute of ["aria-label", "title", "placeholder", "data-label"]) {
        if (element.hasAttribute(attribute)) {
          element.setAttribute(attribute, localizedText(element.getAttribute(attribute), targetLocale));
        }
      }
    }
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement?.closest("script,style,code") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  let node;
  while ((node = walker.nextNode())) {
    const translated = localizedText(node.nodeValue, targetLocale);
    if (translated !== node.nodeValue) node.nodeValue = translated;
  }
}

export function localeTag() {
  return state.locale === "en" ? "en-US" : "zh-CN";
}

export function updateDocumentMetadata() {
  const adminPath = location.pathname.startsWith("/admin");
  const signedIn = adminPath && !appShell.classList.contains("hidden");
  document.title = signedIn
    ? t("Home Tunnel 控制中心", "Home Tunnel Control Center")
    : adminPath
      ? t("登录后台 — Home Tunnel", "Admin sign in — Home Tunnel")
      : t("Home Tunnel — 随时安全访问家里的服务", "Home Tunnel — Secure access to services at home");
  document.querySelector('meta[name="description"]')?.setAttribute(
    "content",
    t(
      "Home Tunnel 让家里的 Web 服务拥有安全、稳定的 HTTPS 访问地址。",
      "Home Tunnel gives your web services at home secure, reliable HTTPS addresses.",
    ),
  );
}

export function applyLocale(locale, persist = true) {
  state.locale = locale === "en" ? "en" : "zh-CN";
  document.documentElement.lang = state.locale;
  translateTree(document, state.locale);
  document.querySelectorAll("[data-locale-toggle]").forEach((button) => {
    const english = state.locale === "en";
    button.textContent = english ? "中文" : "EN";
    const label = english ? "Switch to Chinese" : "Switch to English";
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
  });
  applyTheme(currentTheme(), false);
  updateDocumentMetadata();
  if (persist) {
    try { window.localStorage.setItem(localeStorageKey, state.locale); } catch {}
  }
}

document.querySelectorAll("[data-locale-toggle]").forEach((button) => {
  button.addEventListener("click", () => applyLocale(state.locale === "en" ? "zh-CN" : "en"));
});

const localeObserver = new MutationObserver((records) => {
  for (const record of records) {
    if (record.type === "characterData") {
      translateTree(record.target, state.locale);
      continue;
    }
    for (const node of record.addedNodes) translateTree(node, state.locale);
  }
});
localeObserver.observe(document.body, { childList: true, characterData: true, subtree: true });

const themeStorageKey = "ht_theme";

export function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function applyTheme(theme, persist = true) {
  const normalized = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = normalized;
  document.documentElement.style.colorScheme = normalized;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", normalized === "dark" ? "#0f172a" : "#f8fafc");
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    const isDark = normalized === "dark";
    const label = isDark ? t("切换至浅色主题", "Switch to light theme") : t("切换至深色主题", "Switch to dark theme");
    button.setAttribute("aria-pressed", String(isDark));
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
  });
  if (persist) {
    try { window.localStorage.setItem(themeStorageKey, normalized); } catch {}
  }
}

document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
  button.addEventListener("click", () => applyTheme(currentTheme() === "dark" ? "light" : "dark"));
});

window.addEventListener("storage", (event) => {
  if (event.key === themeStorageKey && (event.newValue === "light" || event.newValue === "dark")) {
    applyTheme(event.newValue, false);
  }
  if (event.key === localeStorageKey && (event.newValue === "zh-CN" || event.newValue === "en")) {
    applyLocale(event.newValue, false);
  }
});

applyLocale(state.locale, false);
