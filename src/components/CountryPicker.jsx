import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { countryFlag, countryName, listCountries, normalizeCountryCode } from "../auth/countries.js";
import "./CountryPicker.css";

function CountryPicker({ value = "", onChange, error = false }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = normalizeCountryCode(value);
  const countries = useMemo(() => listCountries(locale), [locale]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter(
      (row) =>
        row.name.toLowerCase().includes(q) ||
        row.code.toLowerCase().includes(q)
    );
  }, [countries, query]);

  const selectedLabel = selected
    ? `${countryFlag(selected)} ${countryName(selected, locale)}`
    : t("auth.countryPlaceholder");

  return (
    <div className="country-picker">
      <button
        type="button"
        className={`country-picker__value${error ? " is-error" : ""}${open ? " is-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen((prev) => !prev);
          setQuery("");
        }}
      >
        <span>{selectedLabel}</span>
      </button>
      {open ? (
        <div className="country-picker__panel">
          <input
            className="country-picker__search"
            type="search"
            value={query}
            autoFocus
            placeholder={t("auth.countrySearch")}
            aria-label={t("auth.countrySearch")}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ul className="country-picker__list" role="listbox">
            {filtered.map((row) => {
              const active = row.code === selected;
              return (
                <li key={row.code}>
                  <button
                    type="button"
                    className={`country-picker__option${active ? " is-selected" : ""}`}
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onChange?.(row.code);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <span className="country-picker__flag" aria-hidden="true">
                      {row.flag}
                    </span>
                    <span>{row.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default CountryPicker;
