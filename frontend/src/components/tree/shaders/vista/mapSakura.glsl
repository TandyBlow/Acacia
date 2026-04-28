// Sakura style: Japanese town with torii gate + pagoda
float mapSakura(vec3 p) {
  float ground = sdPlane(p, vec3(0.0, 1.0, 0.0), uGroundY);

  // Distant hills
  float hill = sdHill(
    p - vec3(0.0, -4.0, 55.0),
    4.0,
    22.0
  );

  // Torii gate — midground right
  vec3 toriiP = p - vec3(18.0, 0.0, 45.0);
  toriiP = pR(toriiP, -0.3);
  float torii = sdTorii(toriiP);

  // Pagoda — background left
  float pagoda = sdPagoda(p - vec3(-22.0, 0.0, 62.0), 5);

  // Machiya row — midground, repeated
  float townD = 1e10;
  for (int i = 0; i < 20; i++) {
    float fi = float(i);
    float x = -8.0 + fi * 3.5 + hash11(uSeed + 10.0 + fi) * 2.0;
    float z = 35.0 + hash11(uSeed + 20.0 + fi) * 10.0;
    float h = 2.0 + hash11(uSeed + 30.0 + fi) * 1.5;
    vec3 q = p - vec3(x, 0.0, z);
    float house = sdMachiya(q, h);
    townD = min(townD, house);
  }

  float d = ground;
  d = opS(d, hill, 2.0);
  d = min(d, torii);
  d = min(d, pagoda);
  d = min(d, townD);
  return d;
}
