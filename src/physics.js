import * as CANNON from 'cannon-es';

// Kockák mérete: masszív, jól látható asztali méret (12 cm széles, 7 cm magas, 7 cm mély)
export const BLOCK_SIZE = { x: 0.12, y: 0.07, z: 0.07 };

export class PhysicsWorld {
  constructor() {
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.82, 0)
    });

    // Stabilitás maximalizálása: 40 solver iteráció a kőtömbök egymásba csúszásának kizárására
    if (this.world.solver) {
      this.world.solver.iterations = 40;
      this.world.solver.tolerance = 0.00005;
    }

    this.world.allowSleep = true;

    // Kő és talaj kontakt tulajdonságok: maximális súrlódás, nulla pattogás, merev érintkezés
    this.defaultMaterial = new CANNON.Material('stone');
    const contactMaterial = new CANNON.ContactMaterial(
      this.defaultMaterial,
      this.defaultMaterial,
      {
        friction: 0.98,
        restitution: 0.0,
        contactEquationStiffness: 1e8,
        contactEquationRelaxation: 4,
        frictionEquationStiffness: 1e8,
        frictionEquationRelaxation: 4
      }
    );
    this.world.addContactMaterial(contactMaterial);
    this.world.defaultContactMaterial = contactMaterial;

    // Talaj sík (dinamikusan állítható a felismert asztal magasságához)
    this.groundBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Plane(),
      material: this.defaultMaterial
    });
    this.groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.groundBody.position.set(0, 0, 0);
    this.world.addBody(this.groundBody);

    this.syncObjects = [];
  }

  setGroundHeight(y) {
    this.groundBody.position.set(0, y, 0);
  }

  addBox(mesh, worldPos, mass = 0.85, isStatic = true) {
    const size = BLOCK_SIZE;
    // Vízszintes toleranciaköz az oldalirányú feszülések kiküszöbölésére, míg Y-ban pontos felfekvés (nincs zökkenés/zuhanás)
    const halfX = Math.max(0.001, (size.x - 0.001) / 2);
    const halfY = size.y / 2;
    const halfZ = Math.max(0.001, (size.z - 0.001) / 2);
    const shape = new CANNON.Box(new CANNON.Vec3(halfX, halfY, halfZ));
    
    // Alapértelmezetten STATIKUS testként épül fel a vár -> 100%-os mozdulatlanság becsapódásig!
    const body = new CANNON.Body({
      type: isStatic ? CANNON.Body.STATIC : CANNON.Body.DYNAMIC,
      mass: isStatic ? 0 : mass,
      shape: shape,
      material: this.defaultMaterial,
      position: new CANNON.Vec3(worldPos.x, worldPos.y, worldPos.z)
    });

    body.linearDamping = 0.45;
    body.angularDamping = 0.45;
    body.targetMass = mass;
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.08;
    body.sleepTimeLimit = 0.25;

    this.world.addBody(body);
    this.syncObjects.push({ mesh, body });
    return body;
  }

  addSphere(mesh, worldPos, radius, mass = 1.15) {
    const shape = new CANNON.Sphere(radius);
    const body = new CANNON.Body({
      mass: mass,
      shape: shape,
      material: this.defaultMaterial,
      position: new CANNON.Vec3(worldPos.x, worldPos.y, worldPos.z)
    });

    body.linearDamping = 0.04;
    body.angularDamping = 0.04;

    this.world.addBody(body);
    this.syncObjects.push({ mesh, body });
    return body;
  }

  addPlinth(mesh, worldPos, size) {
    const shape = new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2));
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      mass: 0,
      shape: shape,
      material: this.defaultMaterial,
      position: new CANNON.Vec3(worldPos.x, worldPos.y, worldPos.z)
    });
    this.world.addBody(body);
    this.syncObjects.push({ mesh, body });
    return body;
  }

  wakeUpAllBlocks() {
    // Becsapódáskor a statikus kövek dinamikussá válnak a reális omláshoz
    for (const { body, mesh } of this.syncObjects) {
      if (mesh.userData.isCastleBlock && body.type === CANNON.Body.STATIC) {
        body.type = CANNON.Body.DYNAMIC;
        body.mass = body.targetMass || 0.35;
        body.updateMassProperties();
        body.wakeUp();
      }
    }
  }

  wakeUpNear(point, radius = 0.35) {
    // Minden kő felébresztése, hogy a felsőbb szintek ne lebegjenek a levegőben
    this.wakeUpAllBlocks();
  }

  removeObject(mesh) {
    const index = this.syncObjects.findIndex(item => item.mesh === mesh);
    if (index !== -1) {
      const { body } = this.syncObjects[index];
      this.world.removeBody(body);
      this.syncObjects.splice(index, 1);
    }
  }

  clearCastle() {
    const toRemove = [...this.syncObjects];
    for (const item of toRemove) {
      if (item.mesh.userData.isCastleBlock || item.mesh.userData.isFoundation) {
        this.world.removeBody(item.body);
        const idx = this.syncObjects.indexOf(item);
        if (idx !== -1) this.syncObjects.splice(idx, 1);
      }
    }
  }

  step(dt) {
    // Delta-idő lefogása maximum 33 ms-re, megakadályozva a képkockavesztés miatti robbanásokat
    const safeDt = Math.min(dt, 0.033);
    this.world.step(1 / 60, safeDt, 5);

    // Three.js hálók pozíciójának és forgatásának szinkronizálása
    for (const { mesh, body } of this.syncObjects) {
      mesh.position.copy(body.position);
      mesh.quaternion.copy(body.quaternion);
    }
  }
}
