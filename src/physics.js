import * as CANNON from 'cannon-es';

// Kockák és objektumok méretei
export const BLOCK_SIZE = { x: 0.6, y: 0.4, z: 0.4 };

export class PhysicsWorld {
  constructor() {
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.82, 0)
    });

    // Engedélyezzük a testek elaltatását (sleep), így amíg nem éri őket erő/lövés, teljesen mozdulatlanok maradnak!
    this.world.allowSleep = true;

    // Magas súrlódás és minimális pattogás, hogy sziklaszilárdan álljanak
    this.defaultMaterial = new CANNON.Material('default');
    const contactMaterial = new CANNON.ContactMaterial(
      this.defaultMaterial,
      this.defaultMaterial,
      {
        friction: 0.8,     // Nagy tapadás a téglák között
        restitution: 0.05  // Gyakorlatilag nincs magától mikrougrálás
      }
    );
    this.world.addContactMaterial(contactMaterial);
    this.world.defaultContactMaterial = contactMaterial;

    // Talaj létrehozása (statikus sík)
    this.createGround();

    // Szinkronizálandó párok: { mesh, body }
    this.syncObjects = [];
  }

  createGround() {
    const groundBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Plane(),
      material: this.defaultMaterial
    });
    // A Cannon-es Plane alapértelmezetten a Z tengely felé néz, elforgatjuk, hogy felfelé nézzen (Y tengely)
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    groundBody.position.set(0, 0, 0);
    this.world.addBody(groundBody);
    this.groundBody = groundBody;
  }

  addBox(mesh, mass = 1) {
    const size = BLOCK_SIZE;
    const shape = new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2));
    const body = new CANNON.Body({
      mass: mass,
      shape: shape,
      material: this.defaultMaterial,
      position: new CANNON.Vec3(mesh.position.x, mesh.position.y, mesh.position.z),
      quaternion: new CANNON.Quaternion(mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w)
    });

    // Nagyobb csillapítás és azonnali alvási küszöb a mikromozgások kizárására
    body.linearDamping = 0.3;
    body.angularDamping = 0.3;
    body.sleepSpeedLimit = 0.1; // Ha ennél lassabb a mozgás, elalszik a test
    body.sleepTimeLimit = 0.5;

    this.world.addBody(body);
    this.syncObjects.push({ mesh, body });
    return body;
  }

  addSphere(mesh, radius, mass = 5) {
    const shape = new CANNON.Sphere(radius);
    const body = new CANNON.Body({
      mass: mass,
      shape: shape,
      material: this.defaultMaterial,
      position: new CANNON.Vec3(mesh.position.x, mesh.position.y, mesh.position.z)
    });

    this.world.addBody(body);
    this.syncObjects.push({ mesh, body });
    return body;
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
    // Töröljük az összes szinkronizált testet a lövedékek és a talaj kivételével
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
    // 60 FPS fix lépésköz az instabilitás elkerülésére
    this.world.step(1 / 60, dt, 3);

    // Three.js hálók pozíciójának és forgásának frissítése a fizikai testek alapján
    for (const { mesh, body } of this.syncObjects) {
      mesh.position.copy(body.position);
      mesh.quaternion.copy(body.quaternion);
    }
  }
}
