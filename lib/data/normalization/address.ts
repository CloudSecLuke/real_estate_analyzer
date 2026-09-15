// Address normalization (PROP-38; spec §7). Deterministic, dependency-free
// parsing of US street addresses into components plus a canonical key used
// for matching. USPS Publication 28 abbreviation subsets — extend the maps,
// never fork the logic per source.

export interface NormalizedAddress {
  houseNumber?: string;
  streetPreDirection?: string;
  streetName?: string;
  streetSuffix?: string;
  streetPostDirection?: string;
  unit?: string;
  city?: string;
  state?: string;
  postalCode?: string; // 5-digit
  /** Canonical matching key, e.g. "1234 W MAIN ST #2|CINCINNATI|OH|45202" */
  key: string;
  /** Street-line-only key for parcel situs matching. */
  streetKey: string;
}

const DIRECTIONS: Record<string, string> = {
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W",
  NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW",
  N: "N", S: "S", E: "E", W: "W", NE: "NE", NW: "NW", SE: "SE", SW: "SW",
  "N.": "N", "S.": "S", "E.": "E", "W.": "W",
};

const SUFFIXES: Record<string, string> = {
  STREET: "ST", ST: "ST", "ST.": "ST", STR: "ST",
  AVENUE: "AVE", AVE: "AVE", "AVE.": "AVE", AV: "AVE",
  BOULEVARD: "BLVD", BLVD: "BLVD", "BLVD.": "BLVD", BOUL: "BLVD",
  DRIVE: "DR", DR: "DR", "DR.": "DR", DRV: "DR",
  LANE: "LN", LN: "LN", "LN.": "LN",
  ROAD: "RD", RD: "RD", "RD.": "RD",
  COURT: "CT", CT: "CT", "CT.": "CT",
  CIRCLE: "CIR", CIR: "CIR", "CIR.": "CIR", CRCL: "CIR",
  PLACE: "PL", PL: "PL", "PL.": "PL",
  TERRACE: "TER", TER: "TER", TERR: "TER",
  TRAIL: "TRL", TRL: "TRL",
  PARKWAY: "PKWY", PKWY: "PKWY", PKY: "PKWY",
  HIGHWAY: "HWY", HWY: "HWY",
  WAY: "WAY", WY: "WAY",
  SQUARE: "SQ", SQ: "SQ",
  ALLEY: "ALY", ALY: "ALY",
  PIKE: "PIKE", PK: "PIKE",
  RIDGE: "RDG", RDG: "RDG",
  RUN: "RUN",
  CROSSING: "XING", XING: "XING",
  LOOP: "LOOP",
  COVE: "CV", CV: "CV",
  BEND: "BND", BND: "BND",
  POINT: "PT", PT: "PT",
};

const UNIT_DESIGNATORS = new Set([
  "APT", "APT.", "APARTMENT", "UNIT", "STE", "STE.", "SUITE", "#",
  "NO", "NO.", "FL", "FLOOR", "RM", "ROOM", "BLDG", "LOT", "TRLR", "REAR",
]);

const STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
]);

const STATE_NAMES: Record<string, string> = {
  OHIO: "OH", KENTUCKY: "KY", INDIANA: "IN", ILLINOIS: "IL",
};

function clean(input: string): string {
  return input
    .toUpperCase()
    .replace(/[‘’'"]/g, "")
    .replace(/\./g, "")
    .replace(/[,;]+/g, " , ")
    .replace(/\s+/g, " ")
    .trim();
}

function lastSuffixIndex(tokens: string[]): number {
  for (let j = tokens.length - 1; j >= 0; j--) {
    if (SUFFIXES[tokens[j]] !== undefined) return j;
  }
  return -1;
}

/** Parse + normalize a freeform US address (single or multi-line). */
export function normalizeAddress(input: string): NormalizedAddress {
  const flat = clean(input.replace(/\n/g, " , "));
  const tokens = flat.split(" ").filter((t) => t !== "");

  // Consume from the END: zip → state → city (up to a comma boundary);
  // the remainder is the street line.
  let postalCode: string | undefined;
  let state: string | undefined;
  const cityTokens: string[] = [];
  let i = tokens.length - 1;

  // trailing commas
  while (i >= 0 && tokens[i] === ",") i--;
  if (i >= 0 && /^\d{5}(-\d{4})?$/.test(tokens[i])) {
    postalCode = tokens[i].slice(0, 5);
    i--;
  }
  while (i >= 0 && tokens[i] === ",") i--;
  if (i >= 0) {
    const t = tokens[i].replace(/\./g, "");
    if (STATES.has(t)) {
      state = t;
      i--;
    } else if (STATE_NAMES[t]) {
      state = STATE_NAMES[t];
      i--;
    }
  }
  while (i >= 0 && tokens[i] === ",") i--;
  // city: tokens back to the previous comma (or up to 3 tokens as fallback)
  let cityBudget = 4;
  while (i >= 0 && tokens[i] !== "," && cityBudget > 0) {
    // stop if we hit something that's clearly a street suffix and there is
    // no comma structure at all (e.g. "1234 MAIN ST CINCINNATI OH ...")
    cityTokens.unshift(tokens[i]);
    i--;
    cityBudget--;
  }
  while (i >= 0 && tokens[i] === ",") i--;
  let streetTokens = tokens.slice(0, i + 1).filter((t) => t !== ",");

  // Un-comma'd single-line addresses: if no comma separated the street from
  // the city, the "city" grab above may have eaten street tokens. Detect a
  // suffix inside cityTokens and rebalance.
  if (streetTokens.length === 0 && cityTokens.length > 0) {
    const sufIdx = lastSuffixIndex(cityTokens);
    streetTokens =
      sufIdx >= 0 && sufIdx < cityTokens.length - 1
        ? cityTokens.splice(0, sufIdx + 1)
        : cityTokens.splice(0, cityTokens.length);
  } else {
    // A street suffix inside the city grab means the street/city boundary
    // was missed (no comma). Rebalance, keeping at least one city token.
    const sufIdx = lastSuffixIndex(cityTokens);
    if (sufIdx >= 0 && sufIdx < cityTokens.length - 1) {
      streetTokens = [...streetTokens, ...cityTokens.splice(0, sufIdx + 1)];
    }
  }

  // --- street line parsing ---
  let houseNumber: string | undefined;
  let unit: string | undefined;
  let streetPreDirection: string | undefined;
  let streetPostDirection: string | undefined;
  let streetSuffix: string | undefined;

  // unit: "#2", "APT 2", "UNIT B" — scan and strip
  for (let j = 0; j < streetTokens.length; j++) {
    const t = streetTokens[j];
    if (t.startsWith("#") && t.length > 1) {
      unit = t.slice(1);
      streetTokens.splice(j, 1);
      break;
    }
    if (UNIT_DESIGNATORS.has(t) && j + 1 < streetTokens.length) {
      unit = streetTokens[j + 1].replace(/^#/, "");
      streetTokens.splice(j, 2);
      break;
    }
  }

  if (streetTokens.length > 0 && /^\d+[A-Z]?$/.test(streetTokens[0])) {
    houseNumber = streetTokens.shift();
  }
  if (streetTokens.length > 1 && DIRECTIONS[streetTokens[0]]) {
    streetPreDirection = DIRECTIONS[streetTokens.shift()!];
  }
  // post-direction then suffix from the end: "MAIN ST W" or "MAIN ST"
  if (streetTokens.length > 1 && DIRECTIONS[streetTokens[streetTokens.length - 1]] ) {
    const last = streetTokens[streetTokens.length - 1];
    const beforeLast = streetTokens[streetTokens.length - 2];
    if (SUFFIXES[beforeLast]) {
      streetPostDirection = DIRECTIONS[last];
      streetTokens.pop();
    }
  }
  if (streetTokens.length > 1 && SUFFIXES[streetTokens[streetTokens.length - 1]]) {
    streetSuffix = SUFFIXES[streetTokens.pop()!];
  }
  const streetName = streetTokens.join(" ").replace(/\./g, "") || undefined;
  const city = cityTokens.join(" ").replace(/\./g, "") || undefined;

  const streetLine = [
    houseNumber,
    streetPreDirection,
    streetName,
    streetSuffix,
    streetPostDirection,
    unit ? `#${unit}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    houseNumber,
    streetPreDirection,
    streetName,
    streetSuffix,
    streetPostDirection,
    unit,
    city,
    state,
    postalCode,
    streetKey: streetLine,
    key: `${streetLine}|${city ?? ""}|${state ?? ""}|${postalCode ?? ""}`,
  };
}

/** Cheap similarity for fuzzy candidate ranking (0..1): token overlap of
 *  street keys weighted toward the house number matching exactly. */
export function streetSimilarity(a: NormalizedAddress, b: NormalizedAddress): number {
  if (!a.streetKey || !b.streetKey) return 0;
  if (a.streetKey === b.streetKey) return 1;
  const at = new Set(a.streetKey.split(" "));
  const bt = new Set(b.streetKey.split(" "));
  let common = 0;
  for (const t of at) if (bt.has(t)) common++;
  const jaccard = common / (at.size + bt.size - common);
  const houseBonus =
    a.houseNumber && a.houseNumber === b.houseNumber ? 0.25 : 0;
  return Math.min(1, jaccard * 0.75 + houseBonus);
}
