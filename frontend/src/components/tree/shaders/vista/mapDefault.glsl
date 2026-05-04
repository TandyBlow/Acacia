// Default style: hills + scattered trees
float mapDefault(vec3 p) {
  float ground = sdPlane(p, vec3(0.0, 1.0, 0.0), uGroundY);

  // Rolling hills in the distance — pushed further away and lower
  // to prevent blocking sky rays from camera at Y=2.8
  float hill1 = sdHill(
    p - vec3(-10.0, -8.0, 40.0),  // Y: -5.5 → -8.0 (lower)
    4.0 + hash11(uSeed + 1.0) * 2.0,  // radius: 6~10 → 4~6 (smaller)
    18.0 + hash11(uSeed + 2.0) * 5.0
  );
  float hill2 = sdHill(
    p - vec3(15.0, -7.5, 50.0),  // Y: -5.0 → -7.5 (lower)
    3.0 + hash11(uSeed + 3.0) * 1.5,  // radius: 4.5~7.5 → 3~4.5 (smaller)
    15.0 + hash11(uSeed + 4.0) * 4.0
  );
  float hill3 = sdHill(
    p - vec3(0.0, -7.0, 60.0),  // Y: -4.5 → -7.0 (lower)
    2.5 + hash11(uSeed + 5.0) * 1.5,  // radius: 3~5.5 → 2.5~4 (smaller)
    20.0 + hash11(uSeed + 6.0) * 6.0
  );

  float d = ground;
  d = opS(d, hill1, 2.0);
  d = opS(d, hill2, 2.0);
  d = opS(d, hill3, 2.5);
  return d;
}
