const state = {
  csrf: "",
  me: null,
  users: [],
  devices: [],
  connections: [],
  tunnelDomain: "tunnel.example.com",
  tcpTunnels: { enabled: false, port_start: 10000, port_end: 10099 },
  currentView: "dashboard",
  socket: null,
  refreshTimer: null,
  renderId: 0,
  socketReconnectTimer: null,
  audit: {
    page: 1,
    pageSize: 25,
    query: "",
    action: "",
    targetType: "",
  },
};

const landingScreen = document.querySelector("#landing-screen");
const authScreen = document.querySelector("#auth-screen");
const appShell = document.querySelector("#app-shell");
const loginForm = document.querySelector("#login-form");
const passwordForm = document.querySelector("#password-form");
const viewContent = document.querySelector("#view-content");
const pageTitle = document.querySelector("#page-title");
const pageEyebrow = document.querySelector("#page-eyebrow");
const pageActions = document.querySelector("#page-actions");
const modal = document.querySelector("#modal");
const modalForm = document.querySelector("#modal-form");
const modalBody = document.querySelector("#modal-body");
const modalFooter = document.querySelector("#modal-footer");
const modalTitle = document.querySelector("#modal-title");
const modalEyebrow = document.querySelector("#modal-eyebrow");
const modalError = document.querySelector("#modal-error");
const toastRegion = document.querySelector("#toast-region");
const skipLink = document.querySelector("#skip-link");
const sidebarScrim = document.querySelector(".sidebar-scrim");

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
  "Home Tunnel 2.3.0 Windows 图形客户端预览": "Home Tunnel 2.3.0 Windows desktop client preview",
  "Linux 服务版": "Linux service",
  "正在获取最新版本…": "Checking the latest release…",
  "查看 SHA-256": "View SHA-256",
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
  "Windows 使用图形界面，Linux 作为 systemd 服务运行。": "Use the desktop app on Windows or run the systemd service on Linux.",
  "创建连接": "Create connection",
  "切换至浅色主题": "Switch to light theme",
  "切换至深色主题": "Switch to dark theme",
  "填写本地地址和需要的公网子域。": "Enter the local target and the public subdomain you need.",
  "云端管理": "Central management",
  "统一查看设备、状态和访问策略。": "Manage devices, status, and access policies in one place.",
  "同一套安全边界": "One consistent security boundary",
  "按设备选择运行方式": "Choose how each device runs",
  "两种客户端都只接受控制中心签发的 HTTP/HTTPS、自定义域名与管理员授权 TCP 配置和短期租约，不提供通用 FRP 命令行。": "Both clients accept only control-center-issued HTTP/HTTPS, verified custom-domain, administrator-authorized TCP configurations, and short-lived leases; neither exposes a general-purpose FRP CLI.",
  "完整交互": "Full UI",
  "登录、连接管理与实时配置通知": "Sign-in, connection management, and real-time configuration updates",
  "系统托盘、开机启动、诊断与安全更新": "System tray, startup, diagnostics, and secure updates",
  "设备凭据写入 Windows Credential Manager": "Device credentials stored in Windows Credential Manager",
  "前往最新版本": "Get the latest release",
  "Linux 无界面服务": "Linux headless service",
  "Linux 客户端安装摘要": "Linux client installation summary",
  "适合 NAS、家庭服务器和常开的 Linux 主机；配置最长约 3 分钟同步，不含 GUI 与自动更新。": "Designed for NAS devices, home servers, and always-on Linux hosts. Configuration sync can take up to about three minutes; no GUI or automatic updates are included.",
  "查看安装与运维说明": "View installation and operations guide",
  "Windows x64 图形版 · Linux amd64 / arm64 服务版": "Windows x64 desktop · Linux amd64 / arm64 service",
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
  "控制中心 v2.3.0": "Control Center v2.3.0",
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
  "用户可通过 Windows 图形客户端或 Linux 无界面服务完成设备注册。": "Users can register devices with the Windows desktop client or Linux headless service.",
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
  "请先让用户通过 Windows 或 Linux 客户端注册设备": "Ask the user to register a device with the Windows or Linux client first",
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

function t(zh, en) {
  return state.locale === "en" ? en : zh;
}

function localizedText(value, targetLocale = state.locale) {
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

function localizedApiError(data, status) {
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

function translateTree(root = document, targetLocale = state.locale) {
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

function localeTag() {
  return state.locale === "en" ? "en-US" : "zh-CN";
}

function updateDocumentMetadata() {
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

function applyLocale(locale, persist = true) {
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

function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme, persist = true) {
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

const viewMeta = {
  dashboard: ["系统总览", "运行状态"],
  users: ["用户管理", "身份与权限"],
  devices: ["设备管理", "设备信任"],
  connections: ["连接管理", "受管隧道"],
  audit: ["审计事件", "操作轨迹"],
};

async function navigateTo(view, replace = false) {
  if (!viewMeta[view]) return;
  const hash = `#${view}`;
  if (location.hash !== hash) {
    if (replace) history.replaceState(null, "", hash);
    else history.pushState(null, "", hash);
  }
  await renderView(view);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatBytes(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(amount) / Math.log(1024)));
  return `${(amount / 1024 ** index).toLocaleString(localeTag(), { maximumFractionDigits: index ? 1 : 0 })} ${units[index]}`;
}

async function loadLatestRelease() {
  const releaseNote = document.querySelector("#hero-release-note");
  try {
    const response = await fetch("/api/v1/public/releases/latest", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error("RELEASE_UNAVAILABLE");
    const release = await response.json();
    document.querySelectorAll(".download-button").forEach((link) => {
      link.href = release.download_url;
      link.classList.remove("is-disabled");
      link.removeAttribute("aria-disabled");
    });
    const shaNode = document.querySelector("#release-sha");
    shaNode.textContent = release.sha256;
    shaNode.title = release.sha256;
    releaseNote.textContent = `Windows v${release.version} · ${release.architecture} · ${formatBytes(release.size_bytes)}`;
  } catch {
    releaseNote.textContent = "前往 GitHub Releases 获取最新版本";
  }
}

async function loadPublicConfig() {
  try {
    const response = await fetch("/api/v1/public/config", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return;
    const value = await response.json();
    if (typeof value.tunnel_domain !== "string" || !/^[a-z0-9.-]{1,253}$/.test(value.tunnel_domain)) return;
    state.tunnelDomain = value.tunnel_domain;
    document.querySelectorAll("[data-example-subdomain]").forEach((node) => {
      node.textContent = `https://${node.dataset.exampleSubdomain}.${state.tunnelDomain}`;
    });
  } catch {}
}

function formatBps(value) {
  if (value == null) return "不限速";
  const amount = Number(value);
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)} Gbps`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)} Mbps`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)} Kbps`;
  return `${amount} bps`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(localeTag(), { hour12: false });
}

function statusBadge(status) {
  const normalized = String(status ?? "unknown").toLowerCase();
  const tone = ["active", "healthy", "online", "normal"].includes(normalized)
    ? "ok"
    : ["pending", "applying", "degraded", "must_change", "unknown"].includes(normalized)
      ? "warn"
      : ["offline", "disabled"].includes(normalized)
        ? "neutral"
        : "error";
  const label = {
    active: "启用",
    disabled: "已禁用",
    revoked: "已撤销",
    healthy: "健康",
    unhealthy: "异常",
    degraded: "降级",
    unknown: "待确认",
    normal: "正常",
    must_change: "待改密",
    pending: "待应用",
    applying: "应用中",
    online: "在线",
    offline: "离线",
    quota_suspended: "配额停用",
  }[normalized] ?? normalized;
  return `<span class="status-badge ${tone}">${escapeHtml(label)}</span>`;
}

function componentLabel(component) {
  return {
    "control-center": "控制中心",
    sqlite: "SQLite",
    outbox: "策略队列",
    "traffic-gateway": "流量网关",
    frps: "FRPS",
    caddy: "Caddy",
    backup: "备份",
  }[component] ?? component;
}

function configState(device) {
  const applied = Number(device.applied_config_version ?? 0);
  const target = Number(device.config_version ?? 0);
  const inSync = applied === target;
  return `<span class="config-state"><strong class="${inSync ? "" : "drift"}">${inSync ? "已同步" : "待应用"}</strong><small>应用 v${applied} · 目标 v${target}</small></span>`;
}

function toast(message, type = "success") {
  const item = document.createElement("div");
  item.className = `toast ${type === "error" ? "error" : ""}`;
  item.textContent = message;
  toastRegion.append(item);
  window.setTimeout(() => item.remove(), 4500);
}

async function parseResponse(response) {
  if (response.status === 204) return null;
  const type = response.headers.get("content-type") ?? "";
  return type.includes("application/json") ? response.json() : response.text();
}

async function refreshSession() {
  const response = await fetch("/api/v1/auth/refresh", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_type: "web" }),
  });
  if (!response.ok) throw new Error("SESSION_REVOKED");
  const data = await response.json();
  state.csrf = data.csrf_token;
  return data;
}

async function api(path, options = {}, canRefresh = true) {
  const method = options.method ?? "GET";
  const headers = new Headers(options.headers ?? {});
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && state.csrf) headers.set("x-csrf-token", state.csrf);
  headers.set("x-request-id", crypto.randomUUID());
  const response = await fetch(path, { ...options, method, headers, credentials: "same-origin" });
  const data = await parseResponse(response);
  if (response.status === 401 && canRefresh && !path.startsWith("/api/v1/auth/")) {
    await refreshSession();
    return api(path, options, false);
  }
  if (!response.ok) {
    const error = new Error(localizedApiError(data, response.status));
    error.code = data?.error_code;
    error.details = data;
    error.status = response.status;
    throw error;
  }
  return data;
}

// 登录后待改密时，登录密码保存在闭包变量中传递，避免写入隐藏的 DOM 输入框。
let pendingCurrentPassword = null;

function setPendingCurrentPassword(password) {
  pendingCurrentPassword = password;
  const input = document.querySelector("#current-password");
  input.value = "";
  input.required = password == null;
  input.closest(".field").classList.toggle("hidden", password != null);
}

function showLogin(message = "") {
  document.body.classList.add("auth-active");
  state.me = null;
  state.csrf = "";
  setPendingCurrentPassword(null);
  window.clearTimeout(state.socketReconnectTimer);
  state.socketReconnectTimer = null;
  state.socket?.close();
  state.socket = null;
  landingScreen.classList.add("hidden");
  appShell.classList.add("hidden");
  authScreen.classList.remove("hidden");
  skipLink.href = "#auth-screen";
  updateDocumentMetadata();
  loginForm.classList.remove("hidden");
  passwordForm.classList.add("hidden");
  document.querySelector("#login-error").textContent = message;
  window.setTimeout(() => document.querySelector("#login-username").focus(), 0);
}

async function showApp() {
  document.body.classList.remove("auth-active");
  state.me = await api("/api/v1/auth/me");
  if (state.me.role !== "admin") {
    showLogin("该账号没有管理员后台权限");
    return;
  }
  landingScreen.classList.add("hidden");
  authScreen.classList.add("hidden");
  appShell.classList.remove("hidden");
  skipLink.href = "#main-content";
  updateDocumentMetadata();
  document.querySelector("#current-user").textContent = state.me.display_name;
  document.querySelector(".user-chip small").textContent = state.me.username;
  document.querySelector("#user-avatar").textContent = state.me.display_name.slice(0, 1).toUpperCase();
  connectRealtime();
  const hash = location.hash.replace("#", "");
  if (!viewMeta[hash]) history.replaceState(null, "", "#dashboard");
  await renderView(viewMeta[hash] ? hash : "dashboard");
}

function loadingView(view) {
  viewContent.setAttribute("aria-busy", "true");
  viewContent.innerHTML = view === "dashboard"
    ? `<div class="metrics-grid" aria-hidden="true"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div><div class="skeleton skeleton-table" aria-hidden="true"></div>`
    : `<div class="skeleton skeleton-table" aria-hidden="true"></div>`;
}

function renderPageActions(view) {
  const actions = {
    dashboard: `<button class="button button-secondary" data-action="refresh-view">刷新数据</button>`,
    users: `<button class="button button-primary" data-action="create-user">创建用户</button>`,
    devices: `<button class="button button-secondary" data-action="refresh-view">刷新状态</button>`,
    connections: `<button class="button button-primary" data-action="create-connection">创建连接</button>`,
    audit: `<button class="button button-secondary" data-action="refresh-view">刷新事件</button>`,
  };
  pageActions.innerHTML = actions[view] ?? "";
}

async function renderView(view) {
  const renderId = ++state.renderId;
  state.currentView = view;
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  const [title, eyebrow] = viewMeta[view];
  pageTitle.textContent = title;
  pageEyebrow.textContent = eyebrow;
  renderPageActions(view);
  loadingView(view);
  try {
    if (view === "dashboard") await renderDashboard(renderId);
    if (view === "users") await renderUsers(renderId);
    if (view === "devices") await renderDevices(renderId);
    if (view === "connections") await renderConnections(renderId);
    if (view === "audit") await renderAudit(renderId);
    if (renderId !== state.renderId) return;
    viewContent.setAttribute("aria-busy", "false");
    document.querySelector("#main-content").focus({ preventScroll: true });
  } catch (error) {
    if (renderId !== state.renderId) return;
    viewContent.setAttribute("aria-busy", "false");
    if (error.code === "SESSION_REVOKED") {
      showLogin("会话已失效，请重新登录");
      return;
    }
    viewContent.innerHTML = `<div class="panel"><div class="empty-state"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg><strong>无法加载数据</strong><span>${escapeHtml(error.message)}</span><button class="button button-secondary" data-action="refresh-view">重试</button></div></div>`;
  }
}

async function renderDashboard(renderId) {
  const [summary, traffic, health] = await Promise.all([
    api("/api/v1/admin/summary"),
    api("/api/v1/admin/traffic/summary?hours=24"),
    api("/api/v1/admin/system/health"),
  ]);
  if (renderId !== state.renderId) return;
  state.tcpTunnels = summary.tcp_tunnels ?? state.tcpTunnels;
  const totalTraffic = Number(summary.upload_24h) + Number(summary.download_24h);
  viewContent.innerHTML = `
    <div class="dashboard-hero-layout">
      <section class="panel tunnel-pulse-card" aria-label="Tunnel Pulse 核心控制台">
        <div class="pulse-header">
          <div class="pulse-brand">
            <span class="pulse-dot"></span>
            <div>
              <h3>Tunnel Pulse 穿透主控</h3>
              <p>实时连接状态与 24 小时数据流转</p>
            </div>
          </div>
          <span class="status-badge ok">网关正常运行</span>
        </div>
        <div class="pulse-core-metrics">
          <div class="pulse-metric-item">
            <span class="pulse-label">在线 / 总连接</span>
            <div class="pulse-value-large">${Number(summary.online_connections)} <small>/ ${Number(summary.connections)}</small></div>
            <span class="pulse-meta">以服务端运行状态为准</span>
          </div>
          <div class="pulse-metric-item">
            <span class="pulse-label">24 小时传输流量</span>
            <div class="pulse-value-large">${formatBytes(totalTraffic)}</div>
            <span class="pulse-meta">↑ 上传 ${formatBytes(summary.upload_24h)} · ↓ 下载 ${formatBytes(summary.download_24h)}</span>
          </div>
        </div>
      </section>

      <section class="panel health-rail-panel" aria-label="系统组件健康状态">
        <div class="health-rail-header">
          <div class="health-summary">${statusBadge(health.status)}<span><strong>系统组件</strong><small>${health.components.length} 项实时检查</small></span></div>
        </div>
        <div class="health-rail-list">${health.components.map((item) => {
          const tone = item.status === "healthy" ? "" : item.status === "unhealthy" ? "error" : "warn";
          const detail = item.latency_ms == null ? "正常" : `${Number(item.latency_ms).toLocaleString(localeTag())} ms`;
          return `<div class="health-rail-item ${tone}" title="${escapeHtml(item.status)}">
            <span class="health-rail-dot"></span>
            <span class="health-rail-name">${escapeHtml(componentLabel(item.component))}</span>
            <span class="health-rail-val">${detail}</span>
          </div>`;
        }).join("")}</div>
      </section>
    </div>

    <section class="stats-strip-grid" aria-label="关键补充统计">
      <article class="stat-strip-item">
        <span class="stat-strip-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.9"/></svg></span>
        <div class="stat-strip-info">
          <span class="stat-strip-label">启用账号</span>
          <strong class="stat-strip-val">${Number(summary.users).toLocaleString(localeTag())}</strong>
        </div>
      </article>
      <article class="stat-strip-item">
        <span class="stat-strip-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2h14a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm3 17h8"/></svg></span>
        <div class="stat-strip-info">
          <span class="stat-strip-label">在线设备</span>
          <strong class="stat-strip-val">${Number(summary.online_devices).toLocaleString(localeTag())}</strong>
        </div>
      </article>
      <article class="stat-strip-item">
        <span class="stat-strip-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
        <div class="stat-strip-info">
          <span class="stat-strip-label">受管域名</span>
          <strong class="stat-strip-val mono">${escapeHtml(state.tunnelDomain)}</strong>
        </div>
      </article>
    </section>

    <section class="panel table-panel table-section">
      <div class="panel-header">
        <div>
          <h3>流量最高的连接</h3>
          <span class="panel-subtle">过去 24 小时数据传输排行</span>
        </div>
      </div>
      ${traffic.items.length ? `<table class="data-table"><thead><tr><th>连接</th><th>用户</th><th>上传</th><th>下载</th><th>请求</th></tr></thead><tbody>${traffic.items.slice(0, 6).map((item) => `<tr><td data-label="连接"><span class="cell-primary">${escapeHtml(item.name)}</span><span class="cell-secondary mono">${escapeHtml(item.subdomain)}.${escapeHtml(state.tunnelDomain)}</span></td><td data-label="用户">${escapeHtml(item.username)}</td><td data-label="上传" class="mono">${formatBytes(item.upload_bytes)}</td><td data-label="下载" class="mono">${formatBytes(item.download_bytes)}</td><td data-label="请求" class="mono">${Number(item.requests).toLocaleString(localeTag())}</td></tr>`).join("")}</tbody></table>` : emptyState("暂无流量样本", "网关收到业务请求后会按 10 秒桶写入样本。")}
    </section>`;
}

function emptyState(title, detail) {
  return `<div class="empty-state"><span class="empty-state-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM8 9h8M8 13h5"/></svg></span><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`;
}

async function renderUsers(renderId = state.renderId) {
  const data = await api("/api/v1/admin/users");
  if (renderId !== state.renderId) return;
  state.users = data.items;
  viewContent.innerHTML = `
    <section class="panel table-panel">${state.users.length ? `<table class="data-table"><thead><tr><th>用户</th><th>角色</th><th>状态</th><th>设备 / 连接</th><th>账号上限</th><th>本月流量</th><th><span class="visually-hidden">操作</span></th></tr></thead><tbody>${state.users.map((user) => `<tr><td data-label="用户"><span class="cell-primary">${escapeHtml(user.display_name)}</span><span class="cell-secondary mono">${escapeHtml(user.username)}</span></td><td data-label="角色">${user.role === "admin" ? "管理员" : "普通用户"}</td><td data-label="状态">${statusBadge(user.status)} ${user.password_state === "must_change" ? statusBadge("must_change") : ""} ${user.quota_suspended ? statusBadge("quota_suspended") : ""}</td><td data-label="设备 / 连接" class="mono">${user.device_count} / ${user.connection_count}</td><td data-label="账号上限" class="mono">${formatBps(user.bandwidth_limit_bps)}</td><td data-label="本月流量" class="mono">${formatBytes(user.month_to_date_bytes)}${user.monthly_quota_bytes ? ` / ${formatBytes(user.monthly_quota_bytes)}` : ""}</td><td class="actions-cell" data-label="操作"><div class="actions"><button class="button button-quiet button-small" data-action="user-policy" data-id="${user.id}">限速</button><button class="button button-quiet button-small" data-action="reset-password" data-id="${user.id}">重置密码</button><button class="button ${user.status === "active" ? "button-danger" : "button-secondary"} button-small" data-action="toggle-user" data-id="${user.id}" data-status="${user.status}">${user.status === "active" ? "禁用" : "恢复"}</button></div></td></tr>`).join("")}</tbody></table>` : emptyState("还没有用户", "创建首个普通用户并将一次性临时密码安全交付给本人。")}</section>`;
}

async function renderDevices(renderId = state.renderId) {
  const data = await api("/api/v1/admin/devices");
  if (renderId !== state.renderId) return;
  state.devices = data.items;
  viewContent.innerHTML = `
    <section class="panel table-panel">${state.devices.length ? `<table class="data-table"><thead><tr><th>设备</th><th>用户</th><th>状态</th><th>配置</th><th class="hide-tablet">最后在线</th><th class="hide-tablet">租约到期</th><th><span class="visually-hidden">操作</span></th></tr></thead><tbody>${state.devices.map((device) => `<tr><td data-label="设备"><span class="cell-primary">${escapeHtml(device.name)}</span><span class="cell-secondary mono">${escapeHtml(device.id.slice(0, 8))} · 客户端 ${escapeHtml(device.client_version ?? "未知")} · Agent ${escapeHtml(device.agent_version ?? "未知")}</span></td><td data-label="用户">${escapeHtml(device.username)}</td><td data-label="状态">${statusBadge(device.status === "active" && device.online ? "active" : device.status === "active" ? "Offline" : device.status)}</td><td data-label="配置">${configState(device)}</td><td data-label="最后在线" class="hide-tablet">${formatDate(device.last_seen_at)}</td><td data-label="租约到期" class="hide-tablet">${formatDate(device.lease_expires_at)}</td><td class="actions-cell" data-label="操作"><div class="actions"><button class="button button-danger button-small" data-action="delete-device" data-id="${device.id}" data-name="${escapeHtml(device.name)}" aria-label="删除设备 ${escapeHtml(device.name)}">删除</button></div></td></tr>`).join("")}</tbody></table>` : emptyState("还没有注册设备", "用户可通过 Windows 图形客户端或 Linux 无界面服务完成设备注册。")}</section>`;
}

// 访问控制徽章：只依据 access_basic_auth_enabled / access_ip_allowlist 展示
// 状态摘要，绝不涉及口令或哈希。
function accessBadges(connection) {
  const badges = [];
  if (connection.access_ip_allowlist?.length) {
    badges.push(`<span class="status-badge ok" title="${escapeHtml(connection.access_ip_allowlist.join(", "))}">IP 白名单 ×${connection.access_ip_allowlist.length}</span>`);
  }
  if (connection.access_basic_auth_enabled) badges.push('<span class="status-badge ok">Basic Auth</span>');
  return badges.length ? badges.join(" ") : '<span class="cell-secondary">开放</span>';
}

async function renderConnections(renderId = state.renderId) {
  const data = await api("/api/v1/admin/connections");
  if (renderId !== state.renderId) return;
  state.connections = data.items;
  state.tcpTunnels = data.tcp_tunnels ?? state.tcpTunnels;
  viewContent.innerHTML = `
    <section class="panel table-panel">${state.connections.length ? `<table class="data-table"><thead><tr><th>连接</th><th>归属</th><th>状态</th><th>访问控制</th><th>本地目标</th><th>连接上限</th><th>版本</th><th><span class="visually-hidden">操作</span></th></tr></thead><tbody>${state.connections.map((connection) => `<tr><td data-label="连接"><span class="cell-primary">${escapeHtml(connection.name)} ${connection.proxy_type === "tcp" ? '<span class="status-badge warn">TCP</span>' : ""}</span>${connection.public_url ? `<a class="cell-secondary mono" href="${escapeHtml(connection.public_url)}" target="_blank" rel="noopener">${escapeHtml(connection.public_url)}</a>` : `<span class="cell-secondary mono">tcp://${escapeHtml(connection.public_endpoint)}</span>`}${(connection.custom_domains ?? []).map((domain) => `<a class="cell-secondary mono" href="https://${escapeHtml(domain)}" target="_blank" rel="noopener">https://${escapeHtml(domain)}</a>`).join("")}</td><td data-label="归属"><span class="cell-primary">${escapeHtml(connection.username)}</span><span class="cell-secondary">${escapeHtml(connection.device_name)}</span></td><td data-label="状态">${statusBadge(connection.enabled ? connection.state : "disabled")}</td><td data-label="访问控制">${connection.proxy_type === "tcp" ? '<span class="cell-secondary">FRP 租约</span>' : accessBadges(connection)}</td><td data-label="本地目标" class="mono">${connection.proxy_type === "tcp" ? "tcp" : escapeHtml(connection.local_scheme)}://${escapeHtml(connection.local_host)}:${connection.local_port}</td><td data-label="连接上限" class="mono">${connection.proxy_type === "tcp" ? "—" : formatBps(connection.bandwidth_limit_bps)}</td><td data-label="版本" class="mono">v${connection.version} / a${connection.applied_version}</td><td class="actions-cell"><div class="actions">${connection.proxy_type === "http" ? `<button class="button button-quiet button-small" data-action="custom-domains" data-id="${connection.id}">域名</button>` : ""}<button class="button button-quiet button-small" data-action="edit-connection" data-id="${connection.id}">编辑</button><button class="button button-danger button-small" data-action="delete-connection" data-id="${connection.id}">删除</button></div></td></tr>`).join("")}</tbody></table>` : emptyState("还没有连接", "为已注册设备创建 HTTP/HTTPS 连接，或由管理员开启高级 TCP 隧道。")}</section>`;
}

async function renderAudit(renderId = state.renderId) {
  const params = new URLSearchParams({
    page: String(state.audit.page),
    page_size: String(state.audit.pageSize),
  });
  if (state.audit.query) params.set("q", state.audit.query);
  if (state.audit.action) params.set("action", state.audit.action);
  if (state.audit.targetType) params.set("target_type", state.audit.targetType);
  const data = await api(`/api/v1/admin/audit-events?${params}`);
  if (renderId !== state.renderId) return;
  state.audit.page = Number(data.page ?? state.audit.page);
  state.audit.pageSize = Number(data.page_size ?? state.audit.pageSize);
  const total = Number(data.total ?? data.items.length);
  const totalPages = Math.max(1, Number(data.total_pages ?? 1));
  const first = total === 0 ? 0 : (state.audit.page - 1) * state.audit.pageSize + 1;
  const last = total === 0 ? 0 : Math.min(total, first + data.items.length - 1);
  const targetTypes = ["", "User", "Device", "Connection", "Session", "TrafficPolicy"];
  viewContent.innerHTML = `
    <section class="panel audit-filter-panel">
      <form id="audit-filter-form" class="audit-filter-form">
        <div class="field audit-search"><label for="audit-query">关键词</label><input id="audit-query" name="query" type="search" value="${escapeHtml(state.audit.query)}" placeholder="动作、操作者、目标或 Request ID"></div>
        <div class="field"><label for="audit-action">动作</label><input id="audit-action" name="action" value="${escapeHtml(state.audit.action)}" placeholder="例如 LoginSucceeded"></div>
        <div class="field"><label for="audit-target-type">目标类型</label><select id="audit-target-type" name="target_type">${targetTypes.map((value) => `<option value="${value}" ${state.audit.targetType === value ? "selected" : ""}>${value || "全部目标"}</option>`).join("")}</select></div>
        <div class="field"><label for="audit-page-size">每页</label><select id="audit-page-size" name="page_size">${[25, 50, 100].map((value) => `<option value="${value}" ${state.audit.pageSize === value ? "selected" : ""}>${value} 条</option>`).join("")}</select></div>
        <div class="audit-filter-actions"><button class="button button-quiet" type="button" data-action="reset-audit-filter">重置</button><button class="button button-primary" type="submit">筛选</button></div>
      </form>
    </section>
    <section class="panel table-panel audit-table-panel">${data.items.length ? `<table class="data-table"><thead><tr><th>时间</th><th>动作</th><th>操作者</th><th>目标</th><th>Request ID</th></tr></thead><tbody>${data.items.map((item) => `<tr><td data-label="时间">${formatDate(item.created_at)}</td><td data-label="动作"><span class="cell-primary">${escapeHtml(item.action)}</span><span class="cell-secondary">${escapeHtml(item.actor_type)}</span></td><td data-label="操作者" class="mono">${escapeHtml(item.actor_id?.slice(0, 8) ?? "system")}</td><td data-label="目标"><span class="cell-primary">${escapeHtml(item.target_type)}</span><span class="cell-secondary mono">${escapeHtml(item.target_id?.slice(0, 16) ?? "—")}</span></td><td data-label="Request ID" class="mono">${escapeHtml(item.request_id)}</td></tr>`).join("")}</tbody></table>` : emptyState("没有匹配的审计事件", "调整筛选条件后重试。")}
      <footer class="pagination" aria-label="审计事件分页"><span>显示 ${first}–${last}，共 ${total.toLocaleString(localeTag())} 条</span><div><button class="button button-quiet button-small" data-action="audit-page" data-page="${state.audit.page - 1}" ${state.audit.page <= 1 ? "disabled" : ""}>上一页</button><span class="pagination-current">第 ${state.audit.page} / ${totalPages} 页</span><button class="button button-quiet button-small" data-action="audit-page" data-page="${state.audit.page + 1}" ${state.audit.page >= totalPages ? "disabled" : ""}>下一页</button></div></footer>
    </section>`;
}

function field(name, label, value = "", options = {}) {
  const type = options.type ?? "text";
  const attrs = [options.required !== false ? "required" : "", options.min ? `min="${options.min}"` : "", options.max ? `max="${options.max}"` : "", options.minlength ? `minlength="${options.minlength}"` : ""].filter(Boolean).join(" ");
  const helperId = `modal-${name}-helper`;
  return `<div class="field ${options.full ? "full" : ""}"><label for="modal-${name}">${escapeHtml(label)}</label><input id="modal-${name}" name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}" ${options.helper ? `aria-describedby="${helperId}"` : ""} ${attrs}>${options.helper ? `<p class="helper" id="${helperId}">${escapeHtml(options.helper)}</p>` : ""}</div>`;
}

function openModal({ title, eyebrow = "操作", body, submitLabel = "保存", danger = false, onSubmit }) {
  modalTitle.textContent = title;
  modalEyebrow.textContent = eyebrow;
  modalError.textContent = "";
  modalBody.innerHTML = body;
  modalFooter.innerHTML = `<button class="button button-quiet" type="button" data-modal-cancel>取消</button><button class="button ${danger ? "button-danger" : "button-primary"}" type="submit">${escapeHtml(submitLabel)}</button>`;
  modalFooter.querySelector("[data-modal-cancel]").addEventListener("click", () => modal.close("cancel"));
  modalForm.onsubmit = async (event) => {
    event.preventDefault();
    if (!modalForm.checkValidity()) {
      modalForm.reportValidity();
      return;
    }
    const button = modalFooter.querySelector("button[type=submit]");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.classList.add("is-loading");
    const original = button.textContent;
    button.textContent = "处理中…";
    modalError.textContent = "";
    try {
      await onSubmit(new FormData(modalForm), button);
    } catch (error) {
      modalError.textContent = error.message;
      modalError.focus({ preventScroll: true });
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.classList.remove("is-loading");
      button.textContent = original;
    }
  };
  modal.showModal();
  window.setTimeout(() => modalBody.querySelector("input,select,button")?.focus(), 0);
}

function showSecret(title, secret, detail) {
  modalTitle.textContent = title;
  modalEyebrow.textContent = "安全交付";
  modalError.textContent = "";
  modalBody.innerHTML = `<div class="secret-box"><strong>仅显示这一次</strong><span class="secret-value">${escapeHtml(secret)}</span><p class="helper">${escapeHtml(detail)}</p><button class="button button-secondary" type="button" data-copy-secret>复制到剪贴板</button></div>`;
  modalFooter.innerHTML = `<button class="button button-primary" type="button" data-secret-done>我已安全保存</button>`;
  modalBody.querySelector("[data-copy-secret]").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(secret);
      toast("已复制；请通过安全渠道交付");
    } catch {
      modalError.textContent = "浏览器未允许访问剪贴板，请手动选择并复制临时密码。";
    }
  });
  modalFooter.querySelector("[data-secret-done]").addEventListener("click", () => modal.close("done"));
}

async function openCreateUser() {
  openModal({
    title: "创建用户",
    eyebrow: "身份管理",
    body: `<div class="form-grid">${field("username", "用户名", "", { helper: "小写字母、数字、点、下划线或连字符" })}${field("display_name", "显示名称")}
      <div class="field"><label for="modal-role">角色</label><select id="modal-role" name="role"><option value="user">普通用户</option><option value="admin">管理员</option></select></div>
      ${field("bandwidth_mbps", "账号带宽上限 (Mbps)", "", { type: "number", required: false, min: 0.1, helper: "留空表示不限速" })}</div>`,
    submitLabel: "创建并生成临时密码",
    onSubmit: async (form) => {
      const mbps = String(form.get("bandwidth_mbps") ?? "").trim();
      const result = await api("/api/v1/admin/users", { method: "POST", body: JSON.stringify({ username: form.get("username"), display_name: form.get("display_name"), role: form.get("role"), bandwidth_limit_bps: mbps ? Math.round(Number(mbps) * 1_000_000) : null }) });
      showSecret("临时密码", result.temporary_password, "临时密码 72 小时有效，首次登录后必须修改。关闭后无法再次查看。");
      await renderUsers();
    },
  });
}

async function openUserPolicy(userId) {
  const user = state.users.find((item) => item.id === userId);
  if (!user) return;
  openModal({
    title: `账号带宽与配额 · ${user.username}`,
    eyebrow: "带宽与配额策略",
    body: `<div class="notice"><strong>动态共享带宽池</strong><span>该用户全部活跃连接共享此上限；上传和下载共同消耗。</span></div>${field("bandwidth_mbps", "账号带宽上限 (Mbps)", user.bandwidth_limit_bps == null ? "" : user.bandwidth_limit_bps / 1_000_000, { type: "number", required: false, min: 0.1, helper: "留空表示不限速" })}<div class="notice"><strong>月度流量配额</strong><span>按自然月（UTC）统计上传+下载合计；达到配额后网关暂停该用户全部连接，次月自动恢复。本月已用 ${formatBytes(user.month_to_date_bytes)}${user.quota_suspended ? "（当前已因超额停用）" : ""}。</span></div>${field("monthly_quota_gib", "月度配额 (GiB)", user.monthly_quota_bytes == null ? "" : (user.monthly_quota_bytes / (1024 ** 3)).toFixed(2), { type: "number", required: false, min: 0.1, helper: "留空表示不限配额" })}`,
    onSubmit: async (form) => {
      const raw = String(form.get("bandwidth_mbps") ?? "").trim();
      const quotaRaw = String(form.get("monthly_quota_gib") ?? "").trim();
      await api(`/api/v1/admin/traffic-policies/user/${user.id}`, { method: "PATCH", headers: { "if-match": `"${user.policy_version}"` }, body: JSON.stringify({ bandwidth_limit_bps: raw ? Math.round(Number(raw) * 1_000_000) : null, monthly_quota_bytes: quotaRaw ? Math.round(Number(quotaRaw) * (1024 ** 3)) : null }) });
      modal.close("saved");
      toast("账号带宽与配额策略已更新");
      await renderUsers();
    },
  });
}

// ---- 连接访问控制（IP 白名单 + Basic Auth）表单区块 ----
// patch 语义：白名单文本与原值一致则不发送；Basic Auth 通过 keep/set/off 三态
// 决定是否重设或关闭。口令仅在"设置/重设"时提交，界面绝不回显既有口令。
function accessFormFields(connection = null) {
  const allowlistText = (connection?.access_ip_allowlist ?? []).join("\n");
  const basicEnabled = Boolean(connection?.access_basic_auth_enabled);
  const keepOption = connection ? `<option value="keep">保持不变（当前：${basicEnabled ? "已启用" : "未启用"}）</option>` : "";
  return `<div class="field full"><label for="modal-access_allowlist">IP 白名单（每行一个 IP 或 CIDR）</label><textarea id="modal-access_allowlist" name="access_allowlist" rows="3" placeholder="203.0.113.0/24&#10;2001:db8::/64">${escapeHtml(allowlistText)}</textarea><p class="helper">留空表示不限制来源。门禁在网关侧执行，保存后立即生效且不会重启隧道。</p></div>
    <div class="field"><label for="modal-access_basic_mode">Basic Auth 门禁</label><select id="modal-access_basic_mode" name="access_basic_mode">${keepOption}<option value="off">${connection ? "关闭" : "不启用"}</option><option value="set">${connection ? "设置 / 重设凭据" : "启用"}</option></select></div>
    ${field("access_basic_user", "Basic 用户名", "", { required: false, helper: "1-64 字符，不能包含冒号" })}
    ${field("access_basic_password", "Basic 口令", "", { type: "password", required: false, minlength: 8, helper: "8-128 字符；口令不会在界面回显" })}`;
}

function bindAccessModeToggle() {
  const mode = modalBody.querySelector("#modal-access_basic_mode");
  const user = modalBody.querySelector("#modal-access_basic_user");
  const password = modalBody.querySelector("#modal-access_basic_password");
  const apply = () => {
    const active = mode.value === "set";
    for (const input of [user, password]) {
      input.disabled = !active;
      input.required = active;
    }
  };
  mode.addEventListener("change", apply);
  apply();
}

function collectAccessPatch(form, connection = null) {
  const lines = String(form.get("access_allowlist") ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const access = {};
  const originalLines = connection?.access_ip_allowlist ?? [];
  if (lines.join("\n") !== originalLines.join("\n")) access.ip_allowlist = lines.length ? lines : null;
  const mode = String(form.get("access_basic_mode") ?? "keep");
  if (mode === "set") {
    access.basic_auth = {
      username: String(form.get("access_basic_user") ?? "").trim(),
      password: String(form.get("access_basic_password") ?? ""),
    };
  } else if (mode === "off" && connection?.access_basic_auth_enabled) {
    access.basic_auth = null;
  }
  return Object.keys(access).length ? access : undefined;
}

async function openCreateConnection() {
  if (!state.users.length) state.users = (await api("/api/v1/admin/users")).items;
  state.devices = (await api("/api/v1/admin/devices")).items.filter((item) => item.status === "active");
  if (!state.devices.length) {
    toast("请先让用户通过 Windows 或 Linux 客户端注册设备", "error");
    return;
  }
  const userOptions = state.users.filter((item) => item.status === "active").map((user) => `<option value="${user.id}">${escapeHtml(user.display_name)} · ${escapeHtml(user.username)}</option>`).join("");
  const deviceOptions = state.devices.map((device) => `<option value="${device.id}" data-user="${device.user_id}">${escapeHtml(device.name)} · ${escapeHtml(device.username)}</option>`).join("");
  const proxyTypeField = state.tcpTunnels.enabled
    ? `<div class="field"><label for="modal-proxy_type">隧道类型</label><select id="modal-proxy_type" name="proxy_type"><option value="http">HTTP / HTTPS</option><option value="tcp">TCP（高级）</option></select><p class="helper">TCP 端口仅管理员可分配。</p></div>`
    : '<input id="modal-proxy_type" name="proxy_type" type="hidden" value="http">';
  openModal({
    title: "创建受管连接",
    eyebrow: "受管连接",
    body: `<div class="form-grid"><div class="field"><label for="modal-user_id">用户</label><select id="modal-user_id" name="user_id">${userOptions}</select></div><div class="field"><label for="modal-device_id">设备</label><select id="modal-device_id" name="device_id">${deviceOptions}</select></div>${field("name", "连接名称")}${field("subdomain", "连接标识", "", { helper: `HTTP 公网子域为 .${state.tunnelDomain}` })}${proxyTypeField}<div class="field" id="modal-tcp-port-field" hidden>${field("tcp_remote_port", "TCP 公网端口", state.tcpTunnels.port_start, { type: "number", min: state.tcpTunnels.port_start, max: state.tcpTunnels.port_end })}</div><div class="field"><label for="modal-local_scheme">本地协议</label><select id="modal-local_scheme" name="local_scheme"><option value="http">http</option><option value="https">https</option></select></div>${field("local_host", "本地地址", "127.0.0.1")}${field("local_port", "本地端口", "8080", { type: "number", min: 1, max: 65535 })}<div id="modal-http-options" class="field full"><div class="form-grid">${field("bandwidth_mbps", "连接上限 (Mbps)", "", { type: "number", required: false, min: 0.1 })}${accessFormFields()}</div></div><div class="field full"><label><input name="enabled" type="checkbox" checked> 创建后立即启用</label></div></div>`,
    submitLabel: "创建连接",
    onSubmit: async (form) => {
      const mbps = String(form.get("bandwidth_mbps") ?? "").trim();
      const proxyType = String(form.get("proxy_type") ?? "http");
      const access = proxyType === "http" ? collectAccessPatch(form) : undefined;
      await api("/api/v1/admin/connections", { method: "POST", body: JSON.stringify({ user_id: form.get("user_id"), device_id: form.get("device_id"), name: form.get("name"), subdomain: form.get("subdomain"), proxy_type: proxyType, tcp_remote_port: proxyType === "tcp" ? Number(form.get("tcp_remote_port")) : null, local_scheme: proxyType === "tcp" ? "http" : form.get("local_scheme"), local_host: form.get("local_host"), local_port: Number(form.get("local_port")), enabled: form.get("enabled") === "on", bandwidth_limit_bps: proxyType === "http" && mbps ? Math.round(Number(mbps) * 1_000_000) : null, ...(access ? { access } : {}) }) });
      modal.close("saved");
      toast("连接已创建；设备离线时保持 Pending");
      await renderConnections();
    },
  });
  bindAccessModeToggle();
  bindProxyTypeToggle();
  const userSelect = modalBody.querySelector("#modal-user_id");
  const deviceSelect = modalBody.querySelector("#modal-device_id");
  const filterDevices = () => {
    const userId = userSelect.value;
    [...deviceSelect.options].forEach((option) => { option.hidden = option.dataset.user !== userId; });
    const first = [...deviceSelect.options].find((option) => !option.hidden);
    if (first) deviceSelect.value = first.value;
  };
  userSelect.addEventListener("change", filterDevices);
  const firstDeviceUser = state.devices[0]?.user_id;
  if (firstDeviceUser) userSelect.value = firstDeviceUser;
  filterDevices();
}

function bindProxyTypeToggle() {
  const type = modalBody.querySelector("#modal-proxy_type");
  const portField = modalBody.querySelector("#modal-tcp-port-field");
  const port = modalBody.querySelector("#modal-tcp_remote_port");
  const scheme = modalBody.querySelector("#modal-local_scheme");
  const httpOptions = modalBody.querySelector("#modal-http-options");
  if (!type || !portField) return;
  const apply = () => {
    const isTCP = type.value === "tcp";
    portField.hidden = !isTCP;
    if (port) port.required = isTCP;
    if (scheme) { scheme.disabled = isTCP; if (isTCP) scheme.value = "http"; }
    if (httpOptions) httpOptions.hidden = isTCP;
  };
  type.addEventListener("change", apply);
  apply();
}

function openEditConnection(connectionId) {
  const connection = state.connections.find((item) => item.id === connectionId);
  if (!connection) return;
  openModal({
    title: `编辑连接 · ${connection.name}`,
    eyebrow: "版本化更新",
    body: `<div class="form-grid">${field("name", "连接名称", connection.name)}${field("subdomain", "连接标识", connection.subdomain)}<div class="field"><label for="modal-proxy_type">隧道类型</label><select id="modal-proxy_type" name="proxy_type"><option value="http" ${connection.proxy_type !== "tcp" ? "selected" : ""}>HTTP / HTTPS</option><option value="tcp" ${connection.proxy_type === "tcp" ? "selected" : ""} ${!state.tcpTunnels.enabled && connection.proxy_type !== "tcp" ? "disabled" : ""}>TCP（高级）</option></select></div><div class="field" id="modal-tcp-port-field" ${connection.proxy_type === "tcp" ? "" : "hidden"}>${field("tcp_remote_port", "TCP 公网端口", connection.tcp_remote_port ?? state.tcpTunnels.port_start, { type: "number", min: state.tcpTunnels.port_start, max: state.tcpTunnels.port_end })}</div><div class="field"><label for="modal-local_scheme">本地协议</label><select id="modal-local_scheme" name="local_scheme"><option value="http" ${connection.local_scheme === "http" ? "selected" : ""}>http</option><option value="https" ${connection.local_scheme === "https" ? "selected" : ""}>https</option></select></div>${field("local_host", "本地地址", connection.local_host)}${field("local_port", "本地端口", connection.local_port, { type: "number", min: 1, max: 65535 })}<div id="modal-http-options" class="field full" ${connection.proxy_type === "tcp" ? "hidden" : ""}><div class="form-grid">${field("bandwidth_mbps", "连接上限 (Mbps)", connection.bandwidth_limit_bps == null ? "" : connection.bandwidth_limit_bps / 1_000_000, { type: "number", required: false, min: 0.1 })}${accessFormFields(connection)}</div></div><div class="field full"><label><input name="enabled" type="checkbox" ${connection.enabled ? "checked" : ""}> 启用连接</label><p class="helper">当前版本 v${connection.version}；全局关闭 TCP 时，只允许停用既有 TCP 隧道或改回 HTTP。</p></div></div>`,
    onSubmit: async (form) => {
      const mbps = String(form.get("bandwidth_mbps") ?? "").trim();
      const proxyType = String(form.get("proxy_type") ?? "http");
      const access = proxyType === "http" ? collectAccessPatch(form, connection) : undefined;
      await api(`/api/v1/admin/connections/${connection.id}`, { method: "PATCH", headers: { "if-match": `"${connection.version}"` }, body: JSON.stringify({ name: form.get("name"), subdomain: form.get("subdomain"), proxy_type: proxyType, tcp_remote_port: proxyType === "tcp" ? Number(form.get("tcp_remote_port")) : null, local_scheme: proxyType === "tcp" ? "http" : form.get("local_scheme"), local_host: form.get("local_host"), local_port: Number(form.get("local_port")), enabled: form.get("enabled") === "on", bandwidth_limit_bps: proxyType === "http" && mbps ? Math.round(Number(mbps) * 1_000_000) : null, ...(access ? { access } : {}) }) });
      modal.close("saved");
      toast("连接配置已更新");
      await renderConnections();
    },
  });
  bindAccessModeToggle();
  bindProxyTypeToggle();
}

async function openCustomDomains(connectionId) {
  const connection = state.connections.find((item) => item.id === connectionId);
  if (!connection) return;
  const data = await api(`/api/v1/admin/connections/${connectionId}/custom-domains`);
  const rows = data.items.map((domain) => `
    <div class="notice ${domain.status === "verified" ? "" : "notice-warning"}">
      <strong>${escapeHtml(domain.domain)} · ${domain.status === "verified" ? "已验证" : "等待 DNS"}</strong>
      <span class="mono">TXT ${escapeHtml(domain.verification.txt_name)} = ${escapeHtml(domain.verification.txt_value)}<br>CNAME ${escapeHtml(domain.domain)} → ${escapeHtml(domain.verification.cname_target)}</span>
      <div class="actions">${domain.status === "pending" ? `<button class="button button-secondary button-small" type="button" data-domain-verify="${domain.id}">检查 DNS</button>` : ""}<button class="button button-danger button-small" type="button" data-domain-delete="${domain.id}">删除</button></div>
    </div>`).join("");
  openModal({
    title: `自定义域名 · ${connection.name}`,
    eyebrow: "DNS 所有权验证",
    body: `<div class="notice"><strong>需要两条 DNS 记录</strong><span>先添加 TXT 所有权证明，再把域名 CNAME 到受管地址。验证成功后会自动申请证书并重配隧道。</span></div>${rows || '<p class="helper">尚未绑定自定义域名。</p>'}<div class="form-grid">${field("domain", "新增域名", "", { helper: "例如 nas.example.com" })}</div>`,
    submitLabel: "创建验证记录",
    onSubmit: async (form) => {
      await api(`/api/v1/admin/connections/${connectionId}/custom-domains`, { method: "POST", body: JSON.stringify({ domain: form.get("domain") }) });
      modal.close("saved"); toast("验证记录已创建，请配置 DNS"); await openCustomDomains(connectionId);
    },
  });
  modalBody.querySelectorAll("[data-domain-verify]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await api(`/api/v1/admin/custom-domains/${button.dataset.domainVerify}/verify`, { method: "POST", body: "{}" });
      modal.close("saved"); toast("域名验证成功，正在同步隧道"); await renderConnections(); await openCustomDomains(connectionId);
    } catch (error) { modalError.textContent = error.message; button.disabled = false; }
  }));
  modalBody.querySelectorAll("[data-domain-delete]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await api(`/api/v1/admin/custom-domains/${button.dataset.domainDelete}`, { method: "DELETE", body: "{}" });
      modal.close("saved"); toast("自定义域名已删除"); await renderConnections(); await openCustomDomains(connectionId);
    } catch (error) { modalError.textContent = error.message; button.disabled = false; }
  }));
}

function confirmAction(title, detail, submitLabel, onSubmit) {
  openModal({ title, eyebrow: "需要确认", body: `<div class="notice notice-warning"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`, submitLabel, danger: true, onSubmit });
}

appShell.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === "refresh-view") await renderView(state.currentView);
  if (action === "audit-page") {
    state.audit.page = Math.max(1, Number(button.dataset.page) || 1);
    await renderView("audit");
  }
  if (action === "reset-audit-filter") {
    state.audit = { page: 1, pageSize: 25, query: "", action: "", targetType: "" };
    await renderView("audit");
  }
  if (action === "create-user") await openCreateUser();
  if (action === "user-policy") await openUserPolicy(button.dataset.id);
  if (action === "reset-password") {
    const user = state.users.find((item) => item.id === button.dataset.id);
    confirmAction("重置临时密码", `将撤销 ${user?.username ?? "该用户"} 的全部会话，并重新进入首次改密状态。`, "确认重置", async () => {
      const result = await api(`/api/v1/admin/users/${button.dataset.id}/reset-password`, { method: "POST", body: "{}" });
      showSecret("新的临时密码", result.temporary_password, "关闭后无法再次查看；旧密码和全部旧会话已失效。");
      await renderUsers();
    });
  }
  if (action === "toggle-user") {
    const disabling = button.dataset.status === "active";
    const user = state.users.find((item) => item.id === button.dataset.id);
    confirmAction(disabling ? "禁用账号" : "恢复账号", disabling ? `目标 5 秒内阻断 ${user?.username ?? "该用户"} 的全部关联流量。` : `恢复账号后，设备仍需有效凭据和租约才能上线。`, disabling ? "确认禁用" : "确认恢复", async () => {
      await api(`/api/v1/admin/users/${button.dataset.id}/${disabling ? "disable" : "enable"}`, { method: "POST", body: "{}" });
      modal.close("done"); toast(disabling ? "账号禁用正在收敛" : "账号已恢复"); await renderUsers();
    });
  }
  if (action === "delete-device") {
    confirmAction("删除设备", `设备“${button.dataset.name}”的凭据、会话、租约、连接和流量明细将被删除，且无法恢复。`, "确认删除", async () => {
      await api(`/api/v1/admin/devices/${button.dataset.id}`, { method: "DELETE", body: "{}" }); modal.close("done"); toast("设备已删除"); await renderDevices();
    });
  }
  if (action === "create-connection") await openCreateConnection();
  if (action === "custom-domains") await openCustomDomains(button.dataset.id);
  if (action === "edit-connection") openEditConnection(button.dataset.id);
  if (action === "delete-connection") {
    const connection = state.connections.find((item) => item.id === button.dataset.id);
    confirmAction("删除连接", `将先阻断 ${connection?.subdomain ?? "该子域"} 的流量，再写入版本化 tombstone。`, "删除并停止", async () => {
      await api(`/api/v1/admin/connections/${connection.id}`, { method: "DELETE", headers: { "if-match": `"${connection.version}"` }, body: "{}" }); modal.close("done"); toast("连接已删除"); await renderConnections();
    });
  }
});

viewContent.addEventListener("submit", async (event) => {
  if (event.target.id !== "audit-filter-form") return;
  event.preventDefault();
  const form = new FormData(event.target);
  state.audit.query = String(form.get("query") ?? "").trim();
  state.audit.action = String(form.get("action") ?? "").trim();
  state.audit.targetType = String(form.get("target_type") ?? "");
  state.audit.pageSize = [25, 50, 100].includes(Number(form.get("page_size"))) ? Number(form.get("page_size")) : 25;
  state.audit.page = 1;
  await renderView("audit");
});

function closeSidebar() {
  document.querySelector(".sidebar").classList.remove("open");
  document.querySelector("#menu-button").setAttribute("aria-expanded", "false");
}

document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", async () => {
  closeSidebar();
  await navigateTo(button.dataset.view);
}));

document.querySelector("#menu-button").addEventListener("click", (event) => {
  const sidebar = document.querySelector(".sidebar");
  const open = sidebar.classList.toggle("open");
  event.currentTarget.setAttribute("aria-expanded", String(open));
});

sidebarScrim.addEventListener("click", closeSidebar);
window.addEventListener("popstate", () => {
  if (!state.me) return;
  const view = location.hash.replace("#", "");
  if (viewMeta[view]) void renderView(view);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.querySelector(".sidebar").classList.contains("open")) closeSidebar();
});

document.querySelectorAll(".password-toggle").forEach((button) => button.addEventListener("click", () => {
  const input = document.querySelector(`#${button.dataset.target}`);
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  button.setAttribute("aria-label", showing ? "显示密码" : "隐藏密码");
}));

document.querySelectorAll(".download-button").forEach((link) => link.addEventListener("click", (event) => {
  if (link.classList.contains("is-disabled")) event.preventDefault();
}));

document.querySelector("#modal-close").addEventListener("click", () => modal.close("cancel"));
modal.addEventListener("close", () => {
  modalError.textContent = "";
  modalForm.onsubmit = null;
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!loginForm.checkValidity()) {
    loginForm.reportValidity();
    return;
  }
  const errorNode = document.querySelector("#login-error");
  errorNode.textContent = "";
  const button = loginForm.querySelector("button[type=submit]");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.classList.add("is-loading");
  button.textContent = "正在验证…";
  try {
    const form = new FormData(loginForm);
    const result = await api("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ username: form.get("username"), password: form.get("password"), client_type: "web" }) }, false);
    state.csrf = result.csrf_token;
    if (result.password_change_required) {
      loginForm.classList.add("hidden");
      passwordForm.classList.remove("hidden");
      setPendingCurrentPassword(form.get("password"));
      document.querySelector("#new-password").focus();
    } else {
      await showApp();
    }
  } catch (error) {
    errorNode.textContent = error.message;
    document.querySelector("#login-username").setAttribute("aria-invalid", "true");
    document.querySelector("#login-password").setAttribute("aria-invalid", "true");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.classList.remove("is-loading");
    button.textContent = "登录控制中心";
  }
});

loginForm.addEventListener("input", () => {
  document.querySelector("#login-username").removeAttribute("aria-invalid");
  document.querySelector("#login-password").removeAttribute("aria-invalid");
  document.querySelector("#login-error").textContent = "";
});

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!passwordForm.checkValidity()) {
    passwordForm.reportValidity();
    return;
  }
  const errorNode = document.querySelector("#password-error");
  errorNode.textContent = "";
  const form = new FormData(passwordForm);
  const button = passwordForm.querySelector("button[type=submit]");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.classList.add("is-loading");
  const original = button.textContent;
  button.textContent = "正在保存…";
  try {
    await api("/api/v1/auth/password/change", { method: "POST", body: JSON.stringify({ current_password: pendingCurrentPassword ?? form.get("current_password"), new_password: form.get("new_password") }) }, false);
    passwordForm.reset();
    showLogin("密码已修改，请使用新密码重新登录");
  } catch (error) {
    errorNode.textContent = error.message;
    document.querySelector("#new-password").setAttribute("aria-invalid", "true");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.classList.remove("is-loading");
    button.textContent = original;
  }
});

passwordForm.addEventListener("input", () => {
  document.querySelector("#new-password").removeAttribute("aria-invalid");
  document.querySelector("#password-error").textContent = "";
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try { await api("/api/v1/auth/logout", { method: "POST", body: "{}" }, false); } catch {}
  state.socket?.close();
  showLogin("已安全退出");
});

function scheduleRealtimeReconnect() {
  window.clearTimeout(state.socketReconnectTimer);
  if (!state.me) return;
  state.socketReconnectTimer = window.setTimeout(connectRealtime, 3000);
}

function connectRealtime() {
  window.clearTimeout(state.socketReconnectTimer);
  state.socketReconnectTimer = null;
  const previous = state.socket;
  state.socket = null;
  previous?.close();
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  let socket;
  try {
    socket = new WebSocket(`${protocol}//${location.host}/api/v1/ws`);
  } catch {
    scheduleRealtimeReconnect();
    return;
  }
  state.socket = socket;
  socket.addEventListener("message", (event) => {
    if (state.socket !== socket) return;
    try {
      const message = JSON.parse(event.data);
      if (["config.version.changed", "subject.revoked", "runtime.state.changed", "traffic.speed.updated"].includes(message.event)) {
        window.clearTimeout(state.refreshTimer);
        state.refreshTimer = window.setTimeout(() => renderView(state.currentView), 700);
      }
    } catch {}
  });
  socket.addEventListener("close", () => {
    if (state.socket !== socket) return;
    state.socket = null;
    scheduleRealtimeReconnect();
  });
}

(async () => {
  await loadPublicConfig();
  if (!location.pathname.startsWith("/admin")) {
    document.body.classList.remove("auth-active");
    landingScreen.classList.remove("hidden");
    authScreen.classList.add("hidden");
    appShell.classList.add("hidden");
    skipLink.href = "#landing-content";
    await loadLatestRelease();
    return;
  }
  try {
    await refreshSession();
    await showApp();
  } catch {
    showLogin();
  }
})();
