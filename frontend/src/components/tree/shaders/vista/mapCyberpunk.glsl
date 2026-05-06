// Cyberpunk style: skyscraper city
float mapCyberpunk(vec3 p) {
  float ground = sdPlane(p, vec3(0.0, 1.0, 0.0), uGroundY);

  // Ground-level city blocks
  float cityD = 1e10;
  for (int i = 0; i < 25; i++) {
    float fi = float(i);
    float x = -20.0 + fi * 3.8 + hash11(uSeed + 40.0 + fi) * 2.5;
    float z = 25.0 + hash11(uSeed + 50.0 + fi) * 40.0;
    float h = uBuildingHeight * (0.5 + hash11(uSeed + 60.0 + fi) * 0.5);
    float w = 0.8 + hash11(uSeed + 70.0 + fi) * 0.6;
    float ant = hash11(uSeed + 80.0 + fi) > 0.6 ? 1.0 : 0.0;
    vec3 q = p - vec3(x, 0.0, z);
    float bldg = sdSkyscraper(q, h * 7.0, w, ant);
    cityD = min(cityD, bldg);
  }

  // Background towers (taller, further)
  for (int i = 0; i < 20; i++) {
    float fi = float(i);
    float x = -15.0 + fi * 4.5 + hash11(uSeed + 90.0 + fi) * 3.0;
    float z = 55.0 + hash11(uSeed + 100.0 + fi) * 20.0;
    float h = uBuildingHeight * (0.4 + hash11(uSeed + 110.0 + fi) * 0.6);
    float w = 0.6 + hash11(uSeed + 120.0 + fi) * 0.5;
    float ant = hash11(uSeed + 130.0 + fi) > 0.4 ? 1.0 : 0.0;
    vec3 q = p - vec3(x, 0.0, z);
    float bldg = sdSkyscraper(q, h * 9.0, w, ant);
    cityD = min(cityD, bldg);
  }

  float d = ground;
  d = min(d, cityD);
  return d;
}
