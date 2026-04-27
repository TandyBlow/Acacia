// Composite SDFs for architectural elements used in background raymarching

export const SDF_ARCHITECTURE = /* glsl */ `

// --- Torii Gate ---
// Centered, facing forward. Height ~6, width ~5, depth ~1
float sdTorii(vec3 p) {
  // Two vertical columns
  float col1 = sdCylinder(p - vec3(-1.8, 2.5, 0.0), 0.22, 3.0);
  float col2 = sdCylinder(p - vec3(1.8, 2.5, 0.0), 0.22, 3.0);

  // Top horizontal beam (kasagi) — slightly wider
  float beam1 = sdBox(p - vec3(0.0, 5.2, 0.0), vec3(2.6, 0.18, 0.35));

  // Second horizontal beam (shimaki) — slightly smaller
  float beam2 = sdBox(p - vec3(0.0, 4.7, 0.0), vec3(2.3, 0.12, 0.25));

  // Curved top cap (sori) — approximated with a torus
  float cap = sdTorus(
    (p - vec3(0.0, 5.4, 0.0)).xzy,
    2.35, 0.12
  );

  float d = col1;
  d = min(d, col2);
  d = min(d, beam1);
  d = min(d, beam2);
  d = min(d, cap);
  return d;
}

// --- Five-Story Pagoda ---
// Centered, height ~15, each level smaller than the previous
float sdPagoda(vec3 p, int levels) {
  float d = 1e10;
  float totalH = 0.0;

  for (int i = 0; i < 5; i++) {
    if (i >= levels) break;

    float t = float(i) / float(levels);
    float scale = 1.0 - t * 0.55;
    float floorH = totalH;
    float bodyH = 1.2 * scale;

    // Body of this level
    vec3 q = p - vec3(0.0, floorH + bodyH * 0.5, 0.0);
    float body = sdBox(q, vec3(1.6 * scale, bodyH * 0.5, 1.6 * scale));

    // Roof of this level (cone)
    float roofH = 0.8 * scale;
    float roofY = floorH + bodyH;
    vec3 rp = p - vec3(0.0, roofY + roofH * 0.35, 0.0);
    float roof = sdCone(rp, 2.4 * scale, 0.15 * scale, roofH);

    d = min(d, body);
    d = min(d, roof);

    totalH = roofY + roofH * 0.65;
  }

  // Spire on top
  float spire = sdCylinder(p - vec3(0.0, totalH + 0.4, 0.0), 0.08, 0.8);
  float spireTip = sdCone(p - vec3(0.0, totalH + 1.0, 0.0), 0.1, 0.01, 0.3);
  d = min(d, spire);
  d = min(d, spireTip);

  return d;
}

// --- Traditional Machiya (Townhouse) ---
// Simple box body + triangle roof
float sdMachiya(vec3 p, float h) {
  // Main building body
  float body = sdBox(p - vec3(0.0, h * 0.5, 0.0), vec3(1.2, h * 0.5, 1.5));

  // Gable roof — two planes forming a /\ shape, approximated with a box rotated
  // Simpler: use a sloped plane for each side of the roof
  float ridgeH = h + 0.8;
  vec3 roofP = p - vec3(0.0, h, 0.0);

  // Left-sloping roof plane
  float roofL = dot(roofP, normalize(vec3(0.6, 0.8, 0.0))) - 0.05;

  // Right-sloping roof plane
  float roofR = dot(roofP, normalize(vec3(-0.6, 0.8, 0.0))) - 0.05;

  // Front-back roof constraint
  float roofZ = abs(roofP.z) - 1.8;

  float roof = max(max(roofL, roofR), roofZ);

  return min(body, roof);
}

// --- Skyscraper (Cyberpunk) ---
// Tall box with optional antenna
float sdSkyscraper(vec3 p, float h, float w, float antenna) {
  float body = sdBox(p - vec3(0.0, h * 0.5, 0.0), vec3(w, h * 0.5, w));

  float d = body;

  // Antenna on some buildings
  if (antenna > 0.5) {
    float ant = sdCylinder(p - vec3(0.0, h + 0.6, 0.0), 0.06, 1.2);
    d = min(d, ant);
  }

  return d;
}

// --- Neon Sign Panel ---
float sdNeonSign(vec3 p, vec3 size) {
  return sdBox(p, size);
}

// --- Simplified Mountain/Hill ---
float sdHill(vec3 p, float h, float width) {
  // Approximate hill with a stretched sphere
  vec3 q = p;
  q.y /= h;
  q.xz /= width;
  return (length(q) - 1.0) * min(h, width);
}
`;
