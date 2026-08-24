import { Capacitor } from "@capacitor/core";
import { EXPECTED_ERROR_CODES, isExpectedError, isReportableError } from "./expectedErrors.js";
import { APP_VERSION, buildReleaseId } from "./release.js";
import { metadataToTags, pickSafeMetadata } from "./safeMeta.js";
import { sanitizeBreadcrumb, sanitizeEvent } from "./sanitize.js";

export { APP_VERSION, buildReleaseId };

function readEnv(name) {
  try {
    return import.meta.env?.[name];
  } catch {
    return undefined;
  }
}

export function getReleaseId() {
  return buildReleaseId(readEnv("VITE_BUILD_NUMBER") || "dev");
}

export function getPlatform() {
  try {
    const platform = Capacitor.getPlatform?.();
    if (platform === "ios" || platform === "android" || platform === "web") return platform;
  } catch {
    /* node tests */
  }
  return "web";
}

export function getDefaultTags() {
  return {
    appVersion: APP_VERSION,
    buildNumber: String(readEnv("VITE_BUILD_NUMBER") || "dev"),
    environment: String(readEnv("VITE_SENTRY_ENVIRONMENT") || readEnv("MODE") || "development"),
    platform: getPlatform(),
  };
}

/** @type {null | { captureException: Function, addBreadcrumb: Function, setTag: Function }} */
let sentryClient = null;

export function isMonitoringEnabled() {
  return Boolean(sentryClient);
}

/**
 * Used by tests to observe reporting without talking to Sentry.
 * @param {typeof sentryClient} client
 */
export function setMonitoringClient(client) {
  sentryClient = client;
}

export async function initMonitoring() {
  const dsn = readEnv("VITE_SENTRY_DSN");
  if (!dsn) {
    sentryClient = null;
    return { enabled: false };
  }

  const Sentry = await import("@sentry/capacitor");
  const SentryReact = await import("@sentry/react");

  Sentry.init(
    {
      dsn,
      sendDefaultPii: false,
      enableLogs: false,
      tracesSampleRate: 0,
      release: getReleaseId(),
      environment: getDefaultTags().environment,
      enableNative: true,
      enableNativeCrashHandling: true,
      integrations: (integrations) =>
        integrations.filter((item) => item.name !== "Replay" && item.name !== "SessionReplay"),
      beforeSend(event) {
        return sanitizeEvent(event);
      },
      beforeBreadcrumb(breadcrumb) {
        return sanitizeBreadcrumb(breadcrumb);
      },
      initialScope: {
        tags: getDefaultTags(),
      },
    },
    SentryReact.init
  );

  sentryClient = Sentry;
  return { enabled: true };
}

/**
 * Report an unexpected handled failure. Expected control-flow errors are ignored.
 * @param {unknown} error
 * @param {Record<string, unknown>} [metadata]
 * @returns {boolean} true when the event was passed to the monitoring layer
 */
export function reportError(error, metadata = {}) {
  if (!error) return false;
  if (isExpectedError(error)) return false;
  const safe = pickSafeMetadata(metadata);
  sentryClient?.captureException?.(error, {
    tags: metadataToTags(safe),
    extra: safe,
  });
  return isReportableError(error) || !EXPECTED_ERROR_CODES.includes(String(error.code || ""));
}

export function addSafeBreadcrumb(message, data = {}) {
  if (!message || typeof message !== "string") return;
  sentryClient?.addBreadcrumb?.({
    category: "leodomino",
    level: "info",
    message: message.slice(0, 120),
    data: pickSafeMetadata(data),
  });
}

export function setSafeTags(metadata) {
  const tags = metadataToTags(metadata);
  for (const [key, value] of Object.entries(tags)) {
    sentryClient?.setTag?.(key, value);
  }
}
