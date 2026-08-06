import { usePrefs } from "../hooks/usePrefs.js";
import DominoTileClassic from "./DominoTileClassic.jsx";
import LeoDominoPremium from "./LeoDominoPremium.jsx";

/**
 * Shared physical domino used everywhere (hand, board, flight, AI).
 * Picks Classic ivory or Premium Classic (walnut + gold) from prefs.
 */
function DominoTile(props) {
  const { tileSkin } = usePrefs();

  if (tileSkin === "premium") {
    return <LeoDominoPremium {...props} />;
  }

  return <DominoTileClassic {...props} />;
}

export default DominoTile;
