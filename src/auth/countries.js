/**
 * ISO 3166-1 alpha-2 country codes for manual player-profile selection.
 * Haiti (HT) is required. Country is never a unique account identifier.
 */
export const COUNTRY_CODES = Object.freeze([
  "AD", "AE", "AF", "AG", "AL", "AM", "AO", "AR", "AT", "AU",
  "AZ", "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ",
  "BN", "BO", "BR", "BS", "BT", "BW", "BY", "BZ", "CA", "CD",
  "CF", "CG", "CH", "CI", "CL", "CM", "CN", "CO", "CR", "CU",
  "CV", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC",
  "EE", "EG", "ER", "ES", "ET", "FI", "FJ", "FR", "GA", "GB",
  "GD", "GE", "GH", "GM", "GN", "GQ", "GR", "GT", "GW", "GY",
  "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IN", "IQ", "IR",
  "IS", "IT", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM",
  "KN", "KP", "KR", "KW", "KZ", "LA", "LB", "LC", "LI", "LK",
  "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME",
  "MG", "MH", "MK", "ML", "MM", "MN", "MR", "MT", "MU", "MV",
  "MW", "MX", "MY", "MZ", "NA", "NE", "NG", "NI", "NL", "NO",
  "NP", "NR", "NZ", "OM", "PA", "PE", "PG", "PH", "PK", "PL",
  "PT", "PW", "PY", "QA", "RO", "RS", "RU", "RW", "SA", "SB",
  "SC", "SD", "SE", "SG", "SI", "SK", "SL", "SM", "SN", "SO",
  "SR", "SS", "ST", "SV", "SY", "SZ", "TD", "TG", "TH", "TJ",
  "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TZ", "UA", "UG",
  "US", "UY", "UZ", "VA", "VC", "VE", "VN", "VU", "WS", "XK",
  "YE", "ZA", "ZM", "ZW",
]);

export const HAITI_COUNTRY_CODE = "HT";

export function isCountryCode(value) {
  return COUNTRY_CODES.includes(String(value || "").toUpperCase());
}

export function normalizeCountryCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return isCountryCode(code) ? code : "";
}

export function countryFlag(code) {
  const normalized = normalizeCountryCode(code);
  if (!normalized || normalized.length !== 2) return "";
  const A = 0x1f1e6;
  return String.fromCodePoint(
    ...normalized.split("").map((ch) => A + ch.charCodeAt(0) - 65)
  );
}

export function countryName(code, locale = "en") {
  const normalized = normalizeCountryCode(code);
  if (!normalized) return "";
  try {
    const name = new Intl.DisplayNames([locale], { type: "region" }).of(normalized);
    return name || normalized;
  } catch {
    return normalized;
  }
}

export function listCountries(locale = "en") {
  return COUNTRY_CODES.map((code) => ({
    code,
    flag: countryFlag(code),
    name: countryName(code, locale),
  })).sort((a, b) => a.name.localeCompare(b.name, locale));
}
