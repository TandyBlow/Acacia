// Default style: hills + scattered trees
float mapDefault(vec3 p) {
  float ground = sdPlane(p, vec3(0.0, 1.0, 0.0), uGroundY);

  // Rolling hills in the distance
  float hill1 = sdHill(
    p - vec3(-10.0, -5.5, 40.0),
    6.0 + hash11(uSeed + 1.0) * 4.0,
    18.0 + hash11(uSeed + 2.0) * 5.0
  );
  float hill2 = sdHill(
    p - vec3(15.0, -5.0, 50.0),
    4.5 + hash11(uSeed + 3.0) * 3.0,
    15.0 + hash11(uSeed + 4.0) * 4.0
  );
  float hill3 = sdHill(
    p - vec3(0.0, -4.5, 60.0),
    3.0 + hash11(uSeed + 5.0) * 2.5,
    20.0 + hash11(uSeed + 6.0) * 6.0
  );

  float d = ground;
  d = opS(d, hill1, 2.0);
  d = opS(d, hill2, 2.0);
  d = opS(d, hill3, 2.5);
  return d;
}
