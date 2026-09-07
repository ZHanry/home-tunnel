// Reusable form feedback and memory-only drafts. Passwords never enter drafts.
export function formSnapshot(form, includeSecrets = false) {
  return [...form.elements]
    .filter((el) => el.name && (includeSecrets || el.type !== "password"))
    .map((el) => [el.name, el.type === "checkbox" ? el.checked : el.value]);
}

export function restoreSnapshot(form, values) {
  for (const [name, value] of values ?? []) {
    const input = form.elements.namedItem(name);
    if (!input || input.type === "password") continue;
    if (input.type === "checkbox") input.checked = value;
    else input.value = value;
  }
}

export function clearFieldErrors(form) {
  form.querySelectorAll("[data-field-error]").forEach((el) => el.remove());
  form.querySelectorAll('[aria-invalid="true"]').forEach((el) => {
    el.removeAttribute("aria-invalid");
    const ids = (el.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .filter((id) => !id.endsWith("-error"));
    if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
    else el.removeAttribute("aria-describedby");
  });
}

export function showFieldErrors(form, error) {
  const aliases = {
    "access.basic_auth.username": "access_basic_user",
    "access.basic_auth.password": "access_basic_password",
    "access.ip_allowlist": "access_allowlist",
    bandwidth_limit_bps: "bandwidth_mbps",
    monthly_quota_bytes: "monthly_quota_gib",
  };
  let first;
  for (const [field, message] of Object.entries(error.details?.field_errors ?? {})) {
    const input = form.elements.namedItem(aliases[field] ?? field);
    if (!input?.insertAdjacentElement) continue;
    const node = document.createElement("p");
    node.dataset.fieldError = "true";
    node.className = "field-error";
    node.id = `${input.id}-error`;
    node.textContent = Array.isArray(message) ? message.join("；") : String(message);
    input.insertAdjacentElement("afterend", node);
    input.setAttribute("aria-invalid", "true");
    input.setAttribute(
      "aria-describedby",
      `${input.getAttribute("aria-describedby") ?? ""} ${node.id}`.trim(),
    );
    input.closest("details")?.setAttribute("open", "");
    first ??= input;
  }
  first?.focus();
  return Boolean(first);
}

export function setBusy(button, busy, label = "正在保存…") {
  if (busy) {
    button.dataset.idleLabel = button.textContent;
    button.textContent = label;
  } else {
    button.textContent = button.dataset.idleLabel ?? button.textContent;
  }
  button.disabled = busy;
  button.classList.toggle("is-loading", busy);
  button.setAttribute("aria-busy", String(busy));
}

export function changedFields(original, patch) {
  return Object.fromEntries(
    Object.entries(patch).filter(
      ([key, value]) => JSON.stringify(original[key] ?? null) !== JSON.stringify(value ?? null),
    ),
  );
}
