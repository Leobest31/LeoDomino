/** Shared production release identifier. Must match Vite source-map uploads. */

export const APP_VERSION = "1.0.0";

export function buildReleaseId(buildNumber = "dev") {
  const build = String(buildNumber || "").trim() || "dev";
  return `leodomino@${APP_VERSION}+${build}`;
}
