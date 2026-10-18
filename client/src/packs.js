import * as THREE from 'three';

/**
 * Sample character packs. 'default' is built into the engine; 'ember' is a
 * procedural pack registered here (no external files). Downloading it just
 * marks it available locally — spawn() then uses the factory, otherwise the
 * engine falls back to the default humanoid (the PUBG rule).
 */
export const PACKS = [
  { id: 'default', name: 'Default (built-in)' },
  { id: 'ember', name: 'Ember' },
];

export function registerPacks(app) {
  app.assets.characters.registerPack('ember', {
    name: 'Ember',
    factory: buildEmberAvatar,
  });
}

/** Procedural orange-tinted humanoid with a glowing cone crest. Feet at y=0. */
function buildEmberAvatar() {
  const g = new THREE.Group();
  const ember = new THREE.MeshStandardMaterial({ color: 0xe86a2a, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b1a12, roughness: 0.7 });
  const glow = new THREE.MeshStandardMaterial({
    color: 0xffb347,
    emissive: 0xff7b1c,
    emissiveIntensity: 1.4,
    roughness: 0.4,
  });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.75, 6, 16), ember);
  body.position.y = 0.95;

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 24, 18), ember);
  head.position.y = 1.72;

  // Flame crest on the head.
  const crest = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.55, 12), glow);
  crest.position.y = 2.12;

  // Dark arm guards.
  const armGeo = new THREE.CapsuleGeometry(0.09, 0.5, 4, 10);
  const armL = new THREE.Mesh(armGeo, dark);
  armL.position.set(-0.44, 1.0, 0);
  const armR = new THREE.Mesh(armGeo, dark);
  armR.position.set(0.44, 1.0, 0);

  // Ember belt.
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.06, 10, 24), glow);
  belt.position.y = 0.62;
  belt.rotation.x = Math.PI / 2;

  for (const m of [body, head, crest, armL, armR, belt]) {
    m.castShadow = true;
    g.add(m);
  }
  g.userData.packId = 'ember';
  return g;
}
