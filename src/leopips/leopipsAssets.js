/**
 * LeoPips coin assets — local preview family.
 *
 * Production hosted builds must not include the ~2 MB PNG masters.
 * This module imports 512px WebP only (≤ 150 KB each).
 *
 * Family: one master die (100). 20 / 50 / 150 swap only the denomination.
 * Circular 3D gold medallion, milled rim, front-facing crowned lion,
 * LEODOMINO upper rim, LEOPIPS lower rim.
 */

import coin20 from "../assets/leopips/leopips-coin-20.webp";
import coin50 from "../assets/leopips/leopips-coin-50.webp";
import coin100 from "../assets/leopips/leopips-coin-100.webp";
import coin150 from "../assets/leopips/leopips-coin-150.webp";

export const LEOPIPS_COIN_SRC = Object.freeze({
  20: coin20,
  50: coin50,
  100: coin100,
  150: coin150,
});

export function leoPipsCoinSrc(stake) {
  return LEOPIPS_COIN_SRC[Number(stake)] || coin100;
}
