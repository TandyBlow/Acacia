// Platform SDF types for foreground platform layer in raymarch pipeline
// Each platform type is a composite SDF built from IQ primitives in sdfPrimitives.ts
// Scaled to occupy ~5% of screen bottom as a foreground accent.

export const SDF_PLATFORMS = /* glsl */ `

// --- Platform type SDFs ---
// All platforms are centered at origin (0,0,0) in their local space.
// Scaled down (width ~4, height ~1) so they occupy ~5% of screen bottom.
// The caller (map() in backgroundRaymarch.ts) translates by camera-relative platformOrigin.

// Forward declaration: detail placement system (defined below after detail SDFs)
float placeDetailsOnGrid(vec3 p, int platformType, float seed, float cellSize);

// Platform type 0: Cliff (山崖)
float sdCliffPlatform(vec3 p) {
  float cliff = sdCliff(p, 4.0, 1.2, 0.12);

  float boulder1 = sdRoundBox(p - vec3(-1.3, -0.4, 0.1), vec3(0.4, 0.3, 0.3), 0.1);
  float boulder2 = sdRoundBox(p - vec3(1.5, -0.3, -0.1), vec3(0.35, 0.25, 0.3), 0.08);

  float d = cliff;
  d = opS(d, boulder1, 0.1);
  d = opS(d, boulder2, 0.08);

  float details = placeDetailsOnGrid(p, 0, uSeed + 200.0, 0.6);
  d = opS(d, details, 0.04);

  return d;
}

// Platform type 1: Viewing Deck (观景台)
float sdViewingDeck(vec3 p) {
  float deck = sdRoundBox(p, vec3(1.5, 0.08, 0.5), 0.02);

  float col1 = sdCylinder(p - vec3(-1.0, -0.3, -0.2), 0.04, 0.2);
  float col2 = sdCylinder(p - vec3(1.0, -0.3, -0.2), 0.04, 0.2);
  float col3 = sdCylinder(p - vec3(-1.0, -0.3, 0.2), 0.04, 0.2);
  float col4 = sdCylinder(p - vec3(1.0, -0.3, 0.2), 0.04, 0.2);

  float post1 = sdCylinder(p - vec3(-1.2, 0.18, -0.35), 0.02, 0.14);
  float post2 = sdCylinder(p - vec3(1.2, 0.18, -0.35), 0.02, 0.14);
  float post3 = sdCylinder(p - vec3(-1.2, 0.18, 0.35), 0.02, 0.14);
  float post4 = sdCylinder(p - vec3(1.2, 0.18, 0.35), 0.02, 0.14);

  float bar1 = sdBox(p - vec3(0.0, 0.24, -0.35), vec3(1.3, 0.015, 0.015));
  float bar2 = sdBox(p - vec3(0.0, 0.24, 0.35), vec3(1.3, 0.015, 0.015));

  float d = deck;
  d = min(d, col1); d = min(d, col2); d = min(d, col3); d = min(d, col4);
  d = min(d, post1); d = min(d, post2); d = min(d, post3); d = min(d, post4);
  d = min(d, bar1); d = min(d, bar2);

  float details = placeDetailsOnGrid(p, 1, uSeed + 201.0, 0.6);
  d = opS(d, details, 0.03);

  return d;
}

// Platform type 2: Rooftop (天台)
float sdRooftop(vec3 p) {
  float body = sdBox(p - vec3(0.0, -0.7, 0.0), vec3(1.8, 0.75, 0.7));
  float roof = sdBox(p - vec3(0.0, 0.03, 0.0), vec3(1.8, 0.03, 0.7));

  float parapet1 = sdBox(p - vec3(0.0, 0.12, 0.65), vec3(1.9, 0.09, 0.04));
  float parapet2 = sdBox(p - vec3(0.0, 0.12, -0.65), vec3(1.9, 0.09, 0.04));
  float parapet3 = sdBox(p - vec3(-1.8, 0.12, 0.0), vec3(0.04, 0.09, 0.7));
  float parapet4 = sdBox(p - vec3(1.8, 0.12, 0.0), vec3(0.04, 0.09, 0.7));

  float acUnit = sdBox(p - vec3(-0.7, 0.2, 0.3), vec3(0.25, 0.15, 0.18));

  float d = body;
  d = min(d, roof);
  d = min(d, parapet1); d = min(d, parapet2);
  d = min(d, parapet3); d = min(d, parapet4);
  d = min(d, acUnit);

  float details = placeDetailsOnGrid(p, 2, uSeed + 202.0, 0.7);
  d = opS(d, details, 0.04);

  return d;
}

// Platform type 3: Temple Base (寺庙台基)
float sdTempleBase(vec3 p) {
  float base1 = sdBox(p - vec3(0.0, -0.1, 0.0), vec3(1.8, 0.1, 0.9));
  float base2 = sdBox(p - vec3(0.0, 0.06, 0.0), vec3(1.6, 0.07, 0.7));
  float top = sdBox(p - vec3(0.0, 0.16, 0.0), vec3(1.4, 0.04, 0.6));

  float col1 = sdCylinder(p - vec3(-1.2, 0.2, -0.45), 0.06, 0.18);
  float col2 = sdCylinder(p - vec3(1.2, 0.2, -0.45), 0.06, 0.18);
  float col3 = sdCylinder(p - vec3(-1.2, 0.2, 0.45), 0.06, 0.18);
  float col4 = sdCylinder(p - vec3(1.2, 0.2, 0.45), 0.06, 0.18);

  float step1 = sdBox(p - vec3(0.0, -0.2, 0.75), vec3(0.7, 0.03, 0.1));
  float step2 = sdBox(p - vec3(0.0, -0.25, 0.85), vec3(0.9, 0.03, 0.1));

  float d = base1;
  d = min(d, base2);
  d = min(d, top);
  d = min(d, col1); d = min(d, col2); d = min(d, col3); d = min(d, col4);
  d = min(d, step1);
  d = min(d, step2);

  float details = placeDetailsOnGrid(p, 3, uSeed + 203.0, 0.6);
  d = opS(d, details, 0.03);

  return d;
}

// Platform type 4: Megalith (巨石)
float sdMegalith(vec3 p) {
  float boulder = sdRoundBox(p, vec3(1.0, 0.7, 0.5), 0.15);
  float rough = fbm(p.xz * 0.8 + p.y * 0.2) * 0.1;
  boulder += rough;

  float rock2 = sdRoundBox(p - vec3(1.0, -0.2, 0.3), vec3(0.35, 0.25, 0.3), 0.1);
  float rough2 = fbm((p.xz + vec2(1.3, 0.5)) * 1.2) * 0.06;
  rock2 += rough2;

  float d = opS(boulder, rock2, 0.1);

  float details = placeDetailsOnGrid(p, 4, uSeed + 204.0, 0.5);
  d = opS(d, details, 0.04);

  return d;
}

// --- Detail SDFs (PLAT-05) ---
// Small decorative objects placed deterministically on platform surfaces.

float sdGravel(vec3 p) {
  float d = sdRoundBox(p, vec3(0.05, 0.03, 0.05), 0.015);
  float asym = fbm(p.xz * 5.0 + p.y * 2.0) * 0.01;
  return d + asym;
}

float sdSmallRock(vec3 p) {
  float d = sdRoundBox(p, vec3(0.06, 0.04, 0.04), 0.02);
  float rough = fbm(p.xz * 3.0) * 0.015;
  return d + rough;
}

float sdRailingPost(vec3 p) {
  float d = sdCylinder(p, 0.02, 0.1);
  float cap = sdCylinder(p - vec3(0.0, 0.11, 0.0), 0.025, 0.01);
  return min(d, cap);
}

float sdRailingBar(vec3 p) {
  return sdBox(p, vec3(0.4, 0.01, 0.01));
}

float sdAcUnit(vec3 p) {
  float body = sdBox(p, vec3(0.2, 0.12, 0.14));
  float vent1 = sdBox(p - vec3(-0.05, 0.13, 0.0), vec3(0.04, 0.008, 0.12));
  float vent2 = sdBox(p - vec3(0.05, 0.13, 0.0), vec3(0.04, 0.008, 0.12));
  float d = body;
  d = min(d, vent1);
  d = min(d, vent2);
  return d;
}

float sdEdgePost(vec3 p) {
  return sdCylinder(p, 0.015, 0.1);
}

float sdStoneLantern(vec3 p) {
  float base = sdCylinder(p - vec3(0.0, -0.02, 0.0), 0.025, 0.04);
  float body = sdCylinder(p - vec3(0.0, 0.04, 0.0), 0.015, 0.04);
  float top = sdBox(p - vec3(0.0, 0.08, 0.0), vec3(0.03, 0.01, 0.03));
  float d = base;
  d = min(d, body);
  d = min(d, top);
  return d;
}

float sdPillar(vec3 p) {
  return sdCylinder(p, 0.04, 0.14);
}

float sdRubble(vec3 p) {
  float d = sdRoundBox(p, vec3(0.06, 0.035, 0.05), 0.025);
  float rough = fbm(p.xz * 4.0) * 0.01;
  return d + rough;
}

float sdMossPatch(vec3 p) {
  return sdRoundBox(p, vec3(0.09, 0.015, 0.07), 0.03);
}

float sdPebble(vec3 p) {
  return sdRoundBox(p, vec3(0.025, 0.015, 0.025), 0.01);
}

// --- Grid-cell detail placement system ---
float placeDetailsOnGrid(vec3 p, int platformType, float seed, float cellSize) {
  float d = 1e10;
  vec3 cell = floor(p / cellSize);
  vec3 localP = mod(p, cellSize) - cellSize * 0.5;

  float h0 = hash11(seed + cell.x * 13.0 + cell.y * 7.0 + cell.z * 3.0);

  if (h0 > 0.4) {
    float offsetX = (hash11(seed + cell.x * 13.0 + cell.y * 7.0 + cell.z * 3.0 + 1.0) - 0.5) * cellSize * 0.7;
    float offsetZ = (hash11(seed + cell.x * 13.0 + cell.y * 7.0 + cell.z * 3.0 + 2.0) - 0.5) * cellSize * 0.7;
    vec3 detailP = localP - vec3(offsetX, 0.0, offsetZ);

    float typeSelector = hash11(seed + cell.x * 13.0 + cell.y * 7.0 + cell.z * 3.0 + 3.0);

    if (platformType == 0) {
      detailP.y -= 0.55;
      if (typeSelector < 0.5) d = sdGravel(detailP);
      else d = sdSmallRock(detailP);
    } else if (platformType == 1) {
      detailP.y -= 0.1;
      if (typeSelector < 0.5) d = sdRailingPost(detailP);
      else d = sdRailingBar(detailP);
    } else if (platformType == 2) {
      detailP.y -= 0.1;
      if (typeSelector < 0.5) d = sdAcUnit(detailP);
      else d = sdEdgePost(detailP);
    } else if (platformType == 3) {
      detailP.y -= 0.18;
      if (typeSelector < 0.5) d = sdStoneLantern(detailP);
      else d = sdPillar(detailP);
    } else if (platformType == 4) {
      detailP.y -= 0.15;
      if (typeSelector < 0.33) d = sdRubble(detailP);
      else if (typeSelector < 0.66) d = sdMossPatch(detailP);
      else d = sdPebble(detailP);
    }
  }
  return d;
}

// --- Platform dispatch ---
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
