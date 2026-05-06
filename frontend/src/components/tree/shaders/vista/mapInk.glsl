// Ink style: minimal distant mountains
float mapInk(vec3 p) {
  float ground = sdPlane(p, vec3(0.0, 1.0, 0.0), uGroundY);

  // Distant layered mountain silhouettes
  float mtn1 = sdHill(
    p - vec3(-5.0, -6.0, 40.0),
    7.0 + hash11(uSeed + 140.0) * 3.0,
    25.0 + hash11(uSeed + 141.0) * 5.0
  );
  float mtn2 = sdHill(
    p - vec3(8.0, -5.0, 48.0),
    5.0 + hash11(uSeed + 142.0) * 2.0,
    20.0 + hash11(uSeed + 143.0) * 4.0
  );
  float mtn3 = sdHill(
    p - vec3(-12.0, -5.5, 55.0),
    4.5 + hash11(uSeed + 144.0) * 2.5,
    18.0 + hash11(uSeed + 145.0) * 3.0
  );

  float d = ground;
  d = opS(d, mtn1, 1.5);
  d = opS(d, mtn2, 1.5);
  d = opS(d, mtn3, 2.0);
  return d;
}
