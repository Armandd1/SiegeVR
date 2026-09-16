import * as CANNON from 'cannon-es';

// Kockák mérete: kompakt asztali méret (8 cm széles, 5 cm magas, 5 cm mély)
export const BLOCK_SIZE = { x: 0.08, y: 0.05, z: 0.05 };

export class PhysicsWorld {
  constructor() {
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.82, 0)
    });

    this.world.allowSleep = true;

    // Nagy tapadású, stabil anyag
    this.defaultMaterial = new CANNON.Material('default');
    const contactMaterial = new CANNON.ContactMaterial(
      this.defaultMaterial,
      this.defaultMaterial,
      {
        friction: 0.9,
        restitution: 0.02 // zéró pattogás a téglák között
      }
    );
    this.world.addContactMaterial(contactMaterial);
    this.world.defaultContactMaterial = contactMaterial;

    // Talaj sík (dinamikusan állítható az asztal magasságához)
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

  addBox(mesh, worldPos, mass = 0.2) {
    const size = BLOCK_SIZE;
    const shape = new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2));
    
    // Alapértelmezetten STATIKUS testként hozzuk létre (összeragasztva), így magától 100%-ban mozdulatlan
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      mass: 0,
      shape: shape,
      material: this.defaultMaterial,
      position: new CANNON.Vec3(worldPos.x, worldPos.y, worldPos.z)
    });

    body.linearDamping = 0.4;
    body.angularDamping = 0.4;
    body.targetMass = mass; // Eltároljuk a dinamikus tömegét

    this.world.addBody(body);
    this.syncObjects.push({ mesh, body });
    return body;
  }

  addSphere(mesh, worldPos, radius, mass = 0.8) {
    const shape = new CANNON.Sphere(radius);
    const body = new CANNON.Body({
      mass: mass,
      shape: shape,
      material: this.defaultMaterial,
      position: new CANNON.Vec3(worldPos.x, worldPos.y, worldPos.z)
    });

    body.linearDamping = 0.05;
    body.angularDamping = 0.05;

    this.world.addBody(body);
    this.syncObjects.push({ mesh, body });
    return body;
  }

  wakeUpAllBlocks() {
    // Becsapódáskor / lövéskor a statikus köveket azonnal dinamikus fizikai merevtestekké alakítjuk!
    for (const { body, mesh } of this.syncObjects) {
      if (mesh.userData.isCastleBlock && body.type === CANNON.Body.STATIC) {
        body.type = CANNON.Body.DYNAMIC;
        body.mass = body.targetMass || 0.2;
        body.updateMassProperties();
        body.wakeUp();
      }
    }
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
      if (item.mesh.userData.isCastleBlock) {
        this.world.removeBody(item.body);
        const idx = this.syncObjects.indexOf(item);
        if (idx !== -1) this.syncObjects.splice(idx, 1);
      }
    }
  }

  step(dt) {
    this.world.step(1 / 60, dt, 3);

    // Szinkronizáljuk a Three.js hálókat a Cannon testekkel
    for (const { mesh, body } of this.syncObjects) {
      mesh.position.copy(body.position);
      mesh.quaternion.copy(body.quaternion);
    }
  }
}
