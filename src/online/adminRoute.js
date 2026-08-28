/**
 * Admin entry path helpers. Pathname /admin and hash #/admin both count.
 */
export function isAdminLocation(loc = typeof window !== "undefined" ? window.location : null) {
  if (!loc) return false;
  const path = String(loc.pathname || "");
  if (/(^|\/)admin\/?$/i.test(path)) return true;
  const hash = String(loc.hash || "");
  return /^#\/?admin(\/.*)?$/i.test(hash);
}

export function enterAdminLocation(win = typeof window !== "undefined" ? window : null) {
  if (!win?.location || !win.history) return;
  try {
    if (isAdminLocation(win.location)) return;
    const protocol = String(win.location.protocol || "");
    if (protocol === "http:" || protocol === "https:") {
      win.history.pushState({ leoAdmin: true }, "", "/admin");
      return;
    }
    win.location.hash = "#/admin";
  } catch {
    /* ignore */
  }
}

export function canLeaveAdminViaHistory(win = typeof window !== "undefined" ? window : null) {
  if (!win?.history) return false;
  try {
    return Boolean(win.history.state?.leoAdmin) && Number(win.history.length) > 1;
  } catch {
    return false;
  }
}

export function goBackFromAdmin(win = typeof window !== "undefined" ? window : null, onHome) {
  if (canLeaveAdminViaHistory(win)) {
    try {
      win.history.back();
      return;
    } catch {
      /* fall through to Home */
    }
  }
  if (!win?.location || !win.history) {
    onHome?.();
    return;
  }
  try {
    const loc = win.location;
    if (/(^|\/)admin\/?$/i.test(String(loc.pathname || ""))) {
      win.history.replaceState({ leoAdmin: false }, "", "/");
    } else if (/^#\/?admin(\/.*)?$/i.test(String(loc.hash || ""))) {
      loc.hash = "";
    }
  } catch {
    /* ignore */
  }
  onHome?.();
}

export function leaveAdminLocation(win = typeof window !== "undefined" ? window : null) {
  if (!win?.location || !win.history) return;
  try {
    const loc = win.location;
    if (/(^|\/)admin\/?$/i.test(String(loc.pathname || ""))) {
      win.history.pushState({ leoAdmin: false }, "", "/");
      return;
    }
    if (/^#\/?admin(\/.*)?$/i.test(String(loc.hash || ""))) {
      loc.hash = "";
    }
  } catch {
    /* ignore */
  }
}
