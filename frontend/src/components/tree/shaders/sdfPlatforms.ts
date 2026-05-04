// Platform SDF types for foreground platform layer in raymarch pipeline
// Each platform type is a composite SDF built from IQ primitives in sdfPrimitives.ts

export const SDF_PLATFORMS = /* glsl */ `

// --- Platform type SDFs ---
// Each function defines the SDF for one platform archetype.
// All platforms are centered at origin (0,0,0) in their local space.
// The caller (map() in backgroundRaymarch.ts) translates by camera-relative platformOrigin.

// Platform type 0: Cliff (山崖)
// Natural rock formation with irregular top edge and boulders at base
// Forward declaration: detail placement system (defined below after detail SDFs)
float placeDetailsOnGrid(vec3 p, int platformType, float seed, float cellSize);

float sdCliffPlatform(vec3 p) {
  // Main cliff formation using sdCliff primitive (PLAT-01)
  float cliff = sdCliff(p, 12.0, 3.5, 0.15);

  // Base boulders — rounded rocks at cliff bottom
  float boulder1 = sdRoundBox(p - vec3(-4.0, -1.2, 0.3), vec3(1.2, 0.8, 0.8), 0.3);
  float boulder2 = sdRoundBox(p - vec3(4.5, -1.0, -0.2), vec3(1.0, 0.7, 0.9), 0.25);
  float boulder3 = sdRoundBox(p - vec3(0.0, -1.4, 0.6), vec3(1.5, 0.6, 0.7), 0.2);

  float d = cliff;
  d = opS(d, boulder1, 0.3);
  d = opS(d, boulder2, 0.3);
  d = opS(d, boulder3, 0.25);

  // PLAT-05: Detail SDFs (gravel + small rocks on cliff surface)
  float details = placeDetailsOnGrid(p, 0, uSeed + 200.0, 1.5);
  d = opS(d, details, 0.08);

  return d;
}

// Platform type 1: Viewing Deck (观景台)
// Man-made wooden observation platform with railings
float sdViewingDeck(vec3 p) {
  // Main deck surface — wide flat rounded box
  float deck = sdRoundBox(p - vec3(0.0, 0.0, 0.0), vec3(4.0, 0.2, 1.5), 0.05);

  // Support columns underneath the deck
  float col1 = sdCylinder(p - vec3(-3.0, -0.8, -0.5), 0.12, 0.6);
  float col2 = sdCylinder(p - vec3(-3.0, -0.8, 0.5), 0.12, 0.6);
  float col3 = sdCylinder(p - vec3(3.0, -0.8, -0.5), 0.12, 0.6);
  float col4 = sdCylinder(p - vec3(3.0, -0.8, 0.5), 0.12, 0.6);

  // Railing posts (top surface)
  float post1 = sdCylinder(p - vec3(-3.5, 0.5, -1.0), 0.06, 0.4);
  float post2 = sdCylinder(p - vec3(-3.5, 0.5, 1.0), 0.06, 0.4);
  float post3 = sdCylinder(p - vec3(3.5, 0.5, -1.0), 0.06, 0.4);
  float post4 = sdCylinder(p - vec3(3.5, 0.5, 1.0), 0.06, 0.4);

  // Railing bars connecting posts
  float bar1 = sdBox(p - vec3(0.0, 0.7, -1.0), vec3(3.8, 0.04, 0.04));
  float bar2 = sdBox(p - vec3(0.0, 0.7, 1.0), vec3(3.8, 0.04, 0.04));

  float d = deck;
  d = min(d, col1); d = min(d, col2); d = min(d, col3); d = min(d, col4);
  d = min(d, post1); d = min(d, post2); d = min(d, post3); d = min(d, post4);
  d = min(d, bar1); d = min(d, bar2);

  // PLAT-05: Detail SDFs (railing posts + bars along deck edges)
  float details = placeDetailsOnGrid(p, 1, uSeed + 201.0, 1.8);
  d = opS(d, details, 0.06);

  return d;
}

// Platform type 2: Rooftop (天台)
// Urban building rooftop with AC units and edge barrier
float sdRooftop(vec3 p) {
  // Building body — tall box extending downward (only visible top portion)
  float body = sdBox(p - vec3(0.0, -2.0, 0.0), vec3(5.0, 2.15, 2.0));

  // Roof surface — thin box on top
  float roof = sdBox(p - vec3(0.0, 0.08, 0.0), vec3(5.0, 0.08, 2.0));

  // Edge barrier/parapet around the perimeter
  float parapetFront = sdBox(p - vec3(0.0, 0.35, 1.85), vec3(5.2, 0.25, 0.1));
  float parapetBack  = sdBox(p - vec3(0.0, 0.35, -1.85), vec3(5.2, 0.25, 0.1));
  float parapetLeft  = sdBox(p - vec3(-5.0, 0.35, 0.0), vec3(0.1, 0.25, 2.1));
  float parapetRight = sdBox(p - vec3(5.0, 0.35, 0.0), vec3(0.1, 0.25, 2.1));

  // AC unit box on the roof
  float acUnit = sdBox(p - vec3(-2.0, 0.55, 0.8), vec3(0.8, 0.45, 0.5));

  float d = body;
  d = min(d, roof);
  d = min(d, parapetFront); d = min(d, parapetBack);
  d = min(d, parapetLeft); d = min(d, parapetRight);
  d = min(d, acUnit);

  // PLAT-05: Detail SDFs (AC units + edge posts on roof)
  float details = placeDetailsOnGrid(p, 2, uSeed + 202.0, 2.0);
  d = opS(d, details, 0.08);

  return d;
}

// Platform type 3: Temple Base (寺庙台基)
// Traditional temple foundation with layered stone base and columns
float sdTempleBase(vec3 p) {
  // Bottom tier — wide stone base
  float base1 = sdBox(p - vec3(0.0, -0.3, 0.0), vec3(5.0, 0.3, 2.5));

  // Middle tier — slightly narrower
  float base2 = sdBox(p - vec3(0.0, 0.15, 0.0), vec3(4.5, 0.2, 2.0));

  // Top platform surface
  float top = sdBox(p - vec3(0.0, 0.45, 0.0), vec3(4.0, 0.12, 1.8));

  // Stone columns at corners
  float col1 = sdCylinder(p - vec3(-3.5, 0.55, -1.3), 0.18, 0.5);
  float col2 = sdCylinder(p - vec3(-3.5, 0.55, 1.3), 0.18, 0.5);
  float col3 = sdCylinder(p - vec3(3.5, 0.55, -1.3), 0.18, 0.5);
  float col4 = sdCylinder(p - vec3(3.5, 0.55, 1.3), 0.18, 0.5);

  // Steps at front
  float step1 = sdBox(p - vec3(0.0, -0.55, 2.1), vec3(2.0, 0.08, 0.3));
  float step2 = sdBox(p - vec3(0.0, -0.7, 2.4), vec3(2.5, 0.08, 0.3));

  float d = base1;
  d = min(d, base2);
  d = min(d, top);
  d = min(d, col1); d = min(d, col2); d = min(d, col3); d = min(d, col4);
  d = min(d, step1);
  d = min(d, step2);

  // PLAT-05: Detail SDFs (stone lanterns + pillars on temple platform)
  float details = placeDetailsOnGrid(p, 3, uSeed + 203.0, 1.8);
  d = opS(d, details, 0.06);

  return d;
}

// Platform type 4: Megalith (巨石)
// Single massive weathered boulder with organic shape
float sdMegalith(vec3 p) {
  // Main boulder — large rounded box with heavy edge rounding for organic look
  float boulder = sdRoundBox(p - vec3(0.0, 0.0, 0.0), vec3(3.0, 2.0, 1.5), 0.4);

  // Surface roughness via low-frequency noise displacement
  float rough = fbm(p.xz * 0.8 + p.y * 0.2) * 0.25;
  boulder += rough;

  // Secondary smaller rock leaning against the main boulder
  float rock2 = sdRoundBox(p - vec3(2.8, -0.6, 0.8), vec3(1.0, 0.7, 0.8), 0.25);
  float rough2 = fbm((p.xz + vec2(3.7, 1.3)) * 1.2) * 0.15;
  rock2 += rough2;

  float d = opS(boulder, rock2, 0.3);

  // PLAT-05: Detail SDFs (rubble + moss patches + pebbles around megalith)
  float details = placeDetailsOnGrid(p, 4, uSeed + 204.0, 1.2);
  d = opS(d, details, 0.1);

  return d;
}

// --- Detail SDFs (PLAT-05) ---
// Small decorative objects placed deterministically on platform surfaces.
// Uses hash11 grid-cell hashing for deterministic placement on the xz plane.
// Each detail type is a composite of IQ primitives with minimum thickness >= 0.05.

// Individual detail SDF primitives

float sdGravel(vec3 p) {
  // Small irregular pebble
  float d = sdRoundBox(p, vec3(0.12, 0.08, 0.12), 0.04);
  // Add subtle asymmetry
  float asym = fbm(p.xz * 5.0 + p.y * 2.0) * 0.03;
  return d + asym;
}

float sdSmallRock(vec3 p) {
  // Medium-sized irregular rock
  float d = sdRoundBox(p, vec3(0.15, 0.10, 0.10), 0.06);
  float rough = fbm(p.xz * 3.0) * 0.04;
  return d + rough;
}

float sdRailingPost(vec3 p) {
  // Vertical post for railing — height 0.3, radius 0.05
  float d = sdCylinder(p, 0.05, 0.3);
  // Small cap on top
  float cap = sdCylinder(p - vec3(0.0, 0.32, 0.0), 0.07, 0.03);
  return min(d, cap);
}

float sdRailingBar(vec3 p) {
  // Horizontal bar connecting railing posts — thin box
  return sdBox(p, vec3(1.2, 0.03, 0.03));
}

float sdAcUnit(vec3 p) {
  // Air conditioning unit — box with top vent ridges
  float body = sdBox(p, vec3(0.6, 0.35, 0.4));
  // Top vent slats
  float vent1 = sdBox(p - vec3(-0.15, 0.36, 0.0), vec3(0.12, 0.02, 0.35));
  float vent2 = sdBox(p - vec3(0.15, 0.36, 0.0), vec3(0.12, 0.02, 0.35));
  float d = body;
  d = min(d, vent1);
  d = min(d, vent2);
  return d;
}

float sdEdgePost(vec3 p) {
  // Small barrier post for rooftop edges
  return sdCylinder(p, 0.04, 0.3);
}

float sdStoneLantern(vec3 p) {
  // Traditional stone lantern — stacked cylinders + top cap
  float base = sdCylinder(p - vec3(0.0, -0.05, 0.0), 0.06, 0.10);
  float body = sdCylinder(p - vec3(0.0, 0.10, 0.0), 0.04, 0.12);
  float top = sdBox(p - vec3(0.0, 0.23, 0.0), vec3(0.08, 0.03, 0.08));
  float d = base;
  d = min(d, body);
  d = min(d, top);
  return d;
}

float sdPillar(vec3 p) {
  // Ornamental pillar — thicker cylinder
  return sdCylinder(p, 0.12, 0.4);
}

float sdRubble(vec3 p) {
  // Small irregular rock fragment on the ground
  float d = sdRoundBox(p, vec3(0.18, 0.09, 0.14), 0.07);
  float rough = fbm(p.xz * 4.0) * 0.03;
  return d + rough;
}

float sdMossPatch(vec3 p) {
  // Flat moss patch on rock surface — very thin round box
  return sdRoundBox(p, vec3(0.25, 0.04, 0.20), 0.08);
}

float sdPebble(vec3 p) {
  // Tiny pebble
  return sdRoundBox(p, vec3(0.06, 0.04, 0.06), 0.03);
}

// --- Grid-cell detail placement system ---
// Places details deterministically on a 2D grid (xz plane) using hash11.
// cellSize controls spacing between detail cells.
// seed should be unique per platform type to avoid identical layouts.

float placeDetailsOnGrid(vec3 p, int platformType, float seed, float cellSize) {
  float d = 1e10;
  vec3 cell = floor(p / cellSize);
  vec3 localP = mod(p, cellSize) - cellSize * 0.5;

  // Hash cell to determine if this cell has a detail
  float h0 = hash11(seed + cell.x * 13.0 + cell.y * 7.0 + cell.z * 3.0);

  // ~60% of cells get a detail (h0 > 0.4)
  if (h0 > 0.4) {
    // Deterministic position offset within cell (up to +/- 0.35 * cellSize)
    float offsetX = (hash11(seed + cell.x * 13.0 + cell.y * 7.0 + cell.z * 3.0 + 1.0) - 0.5) * cellSize * 0.7;
    float offsetZ = (hash11(seed + cell.x * 13.0 + cell.y * 7.0 + cell.z * 3.0 + 2.0) - 0.5) * cellSize * 0.7;
    vec3 detailP = localP - vec3(offsetX, 0.0, offsetZ);

    // Deterministic detail type selection within this cell
    float typeSelector = hash11(seed + cell.x * 13.0 + cell.y * 7.0 + cell.z * 3.0 + 3.0);

    if (platformType == 0) {
      // Cliff details: gravel + small rocks on top surface and base
      detailP.y -= 1.6;
      if (typeSelector < 0.5) {
        d = sdGravel(detailP);
      } else {
        d = sdSmallRock(detailP);
      }
    } else if (platformType == 1) {
      // Viewing-deck details: railing posts + bars along deck edges
      detailP.y -= 0.3;
      if (typeSelector < 0.5) {
        d = sdRailingPost(detailP);
      } else {
        d = sdRailingBar(detailP);
      }
    } else if (platformType == 2) {
      // Rooftop details: AC units + edge posts on roof surface
      detailP.y -= 0.25;
      if (typeSelector < 0.5) {
        d = sdAcUnit(detailP);
      } else {
        d = sdEdgePost(detailP);
      }
    } else if (platformType == 3) {
      // Temple-base details: stone lanterns + pillars on platform
      detailP.y -= 0.5;
      if (typeSelector < 0.5) {
        d = sdStoneLantern(detailP);
      } else {
        d = sdPillar(detailP);
      }
    } else if (platformType == 4) {
      // Megalith details: rubble + moss patches + pebbles on/around boulder
      detailP.y -= 0.4;
      if (typeSelector < 0.33) {
        d = sdRubble(detailP);
      } else if (typeSelector < 0.66) {
        d = sdMossPatch(detailP);
      } else {
        d = sdPebble(detailP);
      }
    }
  }
  return d;
}

// --- Platform dispatch ---
// Routes to the correct platform SDF based on float type (converted to int).
// type 0 = cliff (山崖)
// type 1 = viewing-deck (观景台)
// type 2 = rooftop (天台)
// type 3 = temple-base (寺庙台基)
// type 4 = megalith (巨石)
// unknown type → 1e10 (effectively infinite distance = miss, no platform rendered)
float sdPlatform(vec3 p, float type) {
  int t = int(type + 0.5);
  if (t == 0) return sdCliffPlatform(p);
  if (t == 1) return sdViewingDeck(p);
  if (t == 2) return sdRooftop(p);
  if (t == 3) return sdTempleBase(p);
  if (t == 4) return sdMegalith(p);
  return 1e10;
}
`;
