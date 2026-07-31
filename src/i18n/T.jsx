import { useI18n } from "./useI18n.js";

/**
 * Mandatory text primitive for visible copy.
 * Future screens should render user-facing strings via <T id="…" /> or t().
 *
 * @param {{ id: string, values?: Record<string, string|number|boolean|null|undefined>, as?: string, className?: string }} props
 */
export function T({ id, values, as: Component = "span", className }) {
  const { t } = useI18n();
  return <Component className={className}>{t(id, values)}</Component>;
}

export default T;
