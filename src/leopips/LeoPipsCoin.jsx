import { leoPipsCoinSrc } from "./leopipsAssets.js";
import "./LeoPipsCoin.css";

/**
 * LeoPips medallion. Used by isolated preview and the live victory overlay.
 */
function LeoPipsCoin({
  stake = 100,
  size = 96,
  alt = "",
  className = "",
}) {
  const src = leoPipsCoinSrc(stake);
  const label = alt || `${stake} LeoPips`;
  return (
    <img
      className={`leopips-coin ${className}`.trim()}
      src={src}
      alt={label}
      width={size}
      height={size}
      draggable={false}
    />
  );
}

export default LeoPipsCoin;
