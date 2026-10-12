# AR Asztali Ostrom & Dimenzió Portál — Projekt Dokumentáció és Napló

Ez a dokumentum rögzíti a projekt célját, technológiai architektúráját, a fejlesztési fázisokat, valamint a meghozott döntéseket és a megvalósítás lépéseit.

---

## 1. A Projekt Célja és Koncepciója
Egy web-alapú kiterjesztett valóság (WebAR) minijáték fejlesztése, amely a játékos asztalára helyez egy interaktív, fizikai alapon működő 3D várat/erődöt, amelyet egy virtuális csúzlival/katapulttal lehet ledönteni.
**Különleges funkció:** Opcionálisan bekapcsolható "Dimenzió Portál" (Portal stencil technológia), amely egy ablakot nyit egy másik 3D világra a valódi asztal felett.

---

## 2. Főbb Rendszerelemek (Architektúra)
* **3D Renderelés:** Three.js (Modern WebGL renderelő, PBR anyagok, dinamikus fények, árnyékok, részecskerendszerek).
* **Fizikai Motor:** `cannon-es` (Könnyű súlyú, megbízható JavaScript fizikai motor: merevtestek, tömeg, rugalmasság, ütközések).
* **AR Követés & Megjelenítés:** WebAR réteg (kamerakép feldolgozás, felület- vagy képkövetés).
* **Portál Illúzió:** Three.js Stencil Buffer maszkolási technika.
* **Irányítás & Interakció:** Érintéses / egér húzással célzó katapult rendszer trajektória (röppálya) előnézettel.
* **Audió & UI:** Web Audio API (procedurális / szintetizált és mintavételezett effektek), modern lebegő HUD kezelőfelület.

---

## 3. Döntési Napló (Decision Log)
*Minden felhasználói döntés és egyeztetés itt kerül rögzítésre időrendben.*

| Dátum / Lépés | Téma | Döntési lehetőségek | Meghozott döntés | Indoklás |
| :--- | :--- | :--- | :--- | :--- |
| 2026-09-16 | AR követés és Fejlesztési stratégia | A: MindAR képkövetés, B: WebXR síkdetektálás, C: Hibrid | **Markerless WebXR Plane Tracking (Hit-Test)** | Marker nélküli, natív AR élmény az asztal felületének automatikus felismerésével. |
| 2026-09-16 | Vár stabilitás (spontán dőlés megszüntetése) | Sima alvás vs. Statikus összeragasztás becsapódásig | **Statikus összeragasztott kövek (Becsapódáskor dinamikus felébredés)** | A vár blokkjai felépítéskor statikusak (mereven össze vannak ragasztva), így fizikai képtelenség, hogy maguktól megmozduljanak vagy elboruljanak. A kilőtt golyó becsapódásakor válnak dinamikus merevtestekké. |
| 2026-09-16 | Csúzli célzási irány | Three.js lookAt Z tengely vs. Közvetlen világvektor | **Közvetlen `dirToCastle` világvektor célzás** | A csúzli helyi Z forgatási anomáliáit kiküszöbölve a lövedék sebessége közvetlenül a csúzli és a vár közötti világvektorból számítódik. Kizárt az ellenkező irányba lövés. |
| 2026-09-17 | Vár stabilitás és becsapódás-vezérlés | Kilövéskori ébresztés vs. Valós ütközéskori ébresztés | **Valós `collide` eseménykori becsapódás-vezérelt ébresztés** | A kilövéskor történő ébresztés helyett a vár kövei nyugalomban maradnak, és kizárólag a lövedék tényleges becsapódásakor (`collide`) válnak dinamikussá. Mellélövés esetén a vár 100%-ban stabilan állva marad. |
| 2026-09-17 | Asztali & Előnézeti Mód | Csak WebXR AR vs. Hibrid Asztali 3D Sandbox + AR | **Hibrid Asztali 3D Sandbox + WebXR AR** | AR munkamenet nélkül a felhasználó azonnal játszhat egy virtuális fa asztalon egérrel vagy érintéssel, míg telefonos AR indításakor az asztal automatikusan eltűnik és a valós felületre vetít. |
| 2026-09-29 | Térbeli méretezés és Stabilitás javítás | Eredeti 8cm kockák vs. 12cm masszív tömbök + súlyponti tömegeloszlás | **12×7×7 cm kockák, 40 solver iteráció, lépcsőzetes tömegeloszlás (1.15kg -> 0.45kg)** | A vár és a kockák ~1.5x méretnövelést kaptak, a kőtalapzat 82cm-esre bővült. Az alsó sorok nehezebbek, így a súlypont alacsonyan marad, a solver és kontakt-merevség (1e8) pedig megelőzi az omlás előtti rezgést. A lövedék mérete és tömege arányosan növekedett. |
| 2026-09-29 | Mobil UI és Ergonómia Felújítás | Alapvető szöveges gombok vs. Mobil-első AR Stepper + Súgó + Haptika | **Prémium Glassmorphism Mobil HUD (3 lépéses AR Stepper, Vártípus váltó, Súgó Modál, Safe-area insets, Haptikus rezgés)** | Érintőképernyő-barát vezérlősáv (min 48px gombok), átfedésmentes lebegő ARButton, telefonos safe-area támogatás, audio némítás és haptikus visszajelzés célozáskor és becsapódáskor. |
| 2026-09-29 | Precíziós Célzórendszer | Közelítő sugaras vizsgálat vs. Valódi kő Raycast + Szimmetrikus húzás | **Tűpontos Raycast kőfelület ütközés, 1:1 szimmetrikus húzás, dinamikus röppálya színkód, visszavonható lövés** | A korábbi durva 42cm-es sugárvizsgálat helyett a trajektória valós Three.js Raycasttel vizsgálja az egyes kőtömbök lapjait. A célkereszt pontosan rásimul a célzott tégla felületére, a röppálya színe az erő arányában változik (Kék -> Sárga -> Piros), és valós idejű célpont-információt ad a HUD-on. |
| 2026-09-29 | Multimodális Vezérlésválasztó | Csak képernyőérintés vs. 3 választható mód (Érintés, Telefonmozgás, Kézkövetés) | **3 Vezérlési Mód Módválasztó Modállal (Touch, Phone Pullback 6DoF, MediaPipe + WebXR Air Pinch)** | A játékos a fejlécben vagy játék előtt választhat: 1. Érintőképernyős ujjhúzás (Touch), 2. Valós telefonnal hátralépés (Phone 6DoF Pullback nyomva tartott gombbal), 3. Kézmozdulat és levegőben csippentés (Air Pinch MediaPipe webkamera PIP előnézettel és WebXR Hand Trackinggel). |
| 2026-09-29 | Memóriakezelés, GC és Fizikai Biztonság | Folyamatos Vector3 példányosítás vs. Újrafelhasznált vektorok + Lövedékürítés | **Zero-Allocation Loop, Teljes Lövedékürítés és Anyag/Geometria Felszabadítás** | Az `updateScore()` képkockánként több ezer Vector3-at allokált a blokkok dőlésének ellenőrzésekor. Tartós `tempUpVector` és `tempCamDelta` használatával a GC-terhelés megszűnt. Újraépítéskor a korábbi lövedékek törlődnek, kizárva a fizikai beékelődési robbanást. |

---

## 4. Megvalósítási Fázisok és Haladás (Roadmap)
- [x] **0. Fázis:** Technológiai alapok és projektstruktúra felállítása (Vite + Three.js + cannon-es).
- [x] **1. Fázis:** 3D Asztali színtér és Fizikai szimuláció (Várépítés kockákból, talaj ütközőfelület, árnyékok).
- [x] **2. Fázis:** Katapult / Csúzli mechanika és Lövedékfizika (Célzóív, erővektorok, becsapódás, téglák dőlése).
- [x] **3. Fázis:** Részecske effektek & Hangeffektek (Becsapódási szikrák, Web Audio API szintetizált effektek).
- [x] **4. Fázis:** Markerless WebXR AR integráció (Hit-Test síkdetektálás, nincs szükség papírkártyára).
- [x] **5. Fázis:** Opcionális "Dimenzió Portál" (Sci-fi lebegő kapu és idegen világ belső tér).
- [x] **6. Fázis:** Felhasználói felület (Glassmorphism HUD, gombok, újratöltés, portál ki/be kapcsoló, pontszám, újrapozicionálás).
- [x] **7. Fázis:** Kétlépcsős lehelyezési rendszer (1. Vár lerakása -> 2. Csúzli lerakása távolabb -> Automatikus célrafordulás).
- [x] **8. Fázis:** Asztali méretarány és fizikai finomhangolás.
- [x] **9. Fázis:** Stabilitás, Vizuális és Fizikai Hibajavítás, Optimalizálás:
  - **Fizika:** 40 solver iteráció, zero restitution, 0.95 tapadás, 0.5 mm kőtömb tolerancia az él-ütközések ellen.
  - **Valós becsapódási ébresztés:** A vár kövei nem omlanak össze kilövéskor; csak közvetlen ütközéskor ébrednek fel a becsapódási pont körül.
  - **3D Gumiszalagok és Csúzli:** Valódi térbeli hengeres gumipántok az 1px-es drótok helyett, bőr lövedéktartó fészek, stabil fa talapzat és réz rögzítőgyűrűk.
  - **Prediktív becsapódási célkereszt:** A céljelző pontosan a vár felületére vagy az asztalra vetül.
  - **Geometriai hibajavítás:** Megszűnt az ikertornyok lebegő hídja, az erőd teherhordó kő áthidalóval és stabil bástyafokokkal épül fel, masszív kő talapzat (plinth) a vár alatt.
  - **Procedurális PBR textúrák:** 256x256-os domborzati és kő textúrák, fa gerendák, izzó meteor lövedék.
  - **Asztali 3D Sandbox Mód:** Bármely böngészőben azonnal játszható virtuális fa asztallal és egérrel/érintéssel.
  - **Vizuális effektek:** Kőtörmelék és füstfelhő, gazdag Web Audio szintetizált hangeffektek (feszülés, suhanás, becsapódás, pontszerzés).
- [x] **10. Fázis:** Teljes Rendszerszintű Finomítás és Tisztítás (GC optimalizálás, audio unlock, lövedékkezelés).
- [x] **11. Fázis:** Felületi Pásztázás, Könnyített Lehelyezés és Kameraközpontú UI Átdolgozás:
  - **Animált Területi Pásztázás (SurfaceScanner):** A felületkereséskor dinamikus sonárhullámok tágulnak a felületen (`RingGeometry` animációval), hatszögletű holografikus szkennelési rács, forgó külső irányzék és lézer célkereszt ad valós idejű visszajelzést a sík detektálásáról.
  - **3D Szellem Előnézet (Holographic Blueprint Ghost):** Mind a 4 vártípushoz (`Fortress`, `Pyramid`, `Twin Towers`, `Citadel`) és a csúzlihoz is áttetsző, ciánkék holografikus előnézet készült. A játékos pontosan látja az építmény körvonalát az asztalon a lehelyezés előtt.
  - **1-Koppintásos "Auto csúzli" lehelyezés:** A vár lehelyezése után a katapult azonnal lehelyezhető egyetlen koppintással optimális távolságra (50 cm), megelőzve az AR térbeli keresgélést szűkös felületeken.
  - **100%-ban Kitakarásmentes Kameraközép:** Eltávolítva a képernyő közepét takaró feszítőgomb, útmutató szövegdoboz és nyíl. Az útmutatók diszkrét mini pillként a fejléc alatt helyezkednek el, a telefonmozgás módhoz pedig egy kézreálló, jobb alsó sarokba dokkolt hüvelykujj-gomb (FAB) tartozik.
  - **Szelfi Kamera Tartalmának Teljes Eltüntetése:** A kézkövetés módban a webkamera előnézeti ablaka és videóképe SOHA nem jelenik meg a felhasználó előtt. A képfeldolgozás tisztán a háttérben fut az AI kézfelismeréshez, a HUD-on pedig csak egy diszkrét állapotjelző látható.
  - **Asztali 3D Körbejárás (OrbitControls):** Asztali és előnézeti módban a felhasználó 360 fokban körbejárhatja és nagyíthatja a virtuális asztalt egérrel, míg a csúzli megfogásakor az orbit vezérlés intelligensen szünetel.

- [x] **12. Fázis:** Rendszerszintű Finomítás, Stabilitás és Minőségi Javítások:
  - **Fizika & Előrejelzés Pontosság:** A fizikai konstansok (`PHYSICS_DT`, `GRAVITY`, `PROJECTILE_DAMPING`) egységesítve lettek a Cannon motor és a trajektória-számítás között. A röppálya pontosan a golyó sugarával (`radius`) kalkulálja az asztallap becsapódását.
  - **Vár Forgatás & Tervek:** A vár és a szellemelőnézet lerakáskor automatikusan a játékos felé fordul (`yaw`). Egyetlen közös elrendezés-leíró forrás vezérli a várat és az előnézetet, megszüntetve a redundanciát. Az újraépítés megtartja az aktuális vártípust.
  - **Közös Slingshot Célzó API:** Egységes `beginAim()`, `setPull()`, `endAim()` interfész vezérli mind a három módot (Érintés, Telefonmozgás, Kézkövetés). Megszűntek a duplikált kódok, hozzáadva a rugós visszacsapódás- és újratöltés-animációt, valamint a pulzáló irányzékot.
  - **Pointer Events Átállás:** A korábbi egér + érintés párhuzamos figyelése helyett modern W3C Pointer Events fut capture fázisban, megelőzve az orbit kamera véletlen elfordulását célzás közben mobilon és asztalon.
  - **Robusztus Kézkövetés:** Skálafüggetlen hiszterézis csippentés-detektálás (kézmérethez normalizálva), EMA zajszűrés a kézremegés ellen, biztonságos kamera- és szálkezelés.
  - **Hang- és Részecskekezelés:** Mester audió busz dinamika-kompresszorral (torzításmentes egyidejű becsapódások), ritkított pontszám-csengetés, perzisztens némításbeállítás (`localStorage`), hálókészlet-újrahasznosítás (pooling) a részecskerendszerben, és megpattanó kőtörmelék.
  - **HTML & UI Tisztítás:** Kijavítva a beágyazott unclosed badge hiba a fejlécben, és perzisztens rekord pontszám (`highScore`) kezelés bevezetve.
  - **Felületi Pásztázás Javítás (Hit-Test Fix):** A WebXR `pose.transform.matrix` egy `Float32Array(16)`, amely nem rendelkezik `.elements` tulajdonsággal (ami korábban kivételt okozott a `setFromMatrixPosition` hívásakor). A `SurfaceScanner.setPose` mostantól közvetlenül és hibamentesen kezeli mind a `Float32Array`, mind a `THREE.Matrix4` formátumot, megengedőbb síkdőlési vizsgálattal, valamint asztali és mobil AR koppintásra azonnal rögzíthető lehelyezéssel.
  - **Finom Csúzli Húzás (Kis Húzási Küszöb):** A korábbi túlzottan szigorú 3.2 cm-es minimális hátrahúzási küszöb (`fireZ`) 0.5 cm-re (5 mm-re) csökkentve. A katapult most már a legkisebb, finom mozdulattal történő ujjhúzásra is azonnal és lágyan kilövi a golyót ahelyett, hogy visszaugrana az alaphelyzetbe. A lövés csak akkor vonódik vissza, ha a játékos kifejezetten visszaengedi a golyót a nyugalmi origóra.

- [x] **13. Fázis:** UI Letisztítás, Átláthatóság, Teljesítményoptimalizálás és Terep-szkennelő Animáció:
  - **Letisztult, Átlátható UI (Minimal Glassmorphism HUD):**
    - Fejléc egységesítése: egyetlen összefogott `brand-pill` fogja össze az AR Ostrom logót és a vártípust (amire koppintva közvetlenül is váltható a vár).
    - Kompakt, modern lebegő üveg dokk (`.hud-dock`) a láblécben: átlátható, lekerekített kapszula-design (`🔄 Újraépítés`, `🎲 Vártípus`, `✨ Auto csúzli`, `📍 Áthelyezés`), megszűntek az egymásra csúszó, túlméretes sávok.
    - Teljesen tiszta és akadálymentes képernyőközép a maximális vizuális élményért.
  - **Méretezés Finomítása (Kisebb Vár és Csúzli):**
    - A vár kőtömbjei ~26%-kal kisebbek lettek (`8.8 × 5.2 × 5.2 cm` az asztali és mobil AR méretarányhoz igazítva), a kőtalapzat `60 × 48 cm`-re csökkent.
    - A csúzli magassága ~15 cm-re finomult, a golyó átmérője 5 cm-esre mérséklődött, a villa és gumiszalagok arányosan kisebbek lettek.
    - A virtuális asztal és lehelyezési távolságok arányosan finomhangolva (auto csúzli távolság: 42 cm, minimális távolság: 16 cm).
  - **Lag-mentesítés Mindhárom Módban (Touch, Phone Motion, Hand Tracking):**
    - **Trajektória AABB Doboz-szűrés:** Korábban a trajektória 90 lépésben képkockánként akár 3600 sugármetszést végzett az összes kőre. Új AABB cullinggal csak akkor fut sugármetszés, ha a szakasz közvetlenül a vár befoglaló dobozát metszi (1-2 teszt), megszüntetve a CPU akadást ujjhúzáskor és telefonmozgáskor.
    - **MediaPipe Kézkövetés Optimalizáció:** `modelComplexity: 0` (Lite modell) bevezetése, egyidejűségi zárolás (`isProcessing`) a felgyülemlő aszinkron várakozási sorok ellen, és 30 FPS képkocka-korlát az AI feldolgozáshoz.
    - **Fizikai Megoldó:** A Cannon solver iterációk száma 40-ről 18-ra csökkentve, a safeDt al-lépések 5-ről 3-ra mérsékelve, több mint 50%-kal csökkentve a fizikai szál terhelését.
    - **Árnyék- és GPU Tehermentesítés:** DirectionalLight árnyéktérkép 2048-ról 1024-re csökkentve (75% GPU fillrate megtakarítás), a WebGL felbontásarány 1.75 DPR-re korlátozva mobiltelefonokon.
    - **Ritkított Pontszám-vizsgálat:** Az `updateScore()` csak minden 4. képkockán fut le, elkerülve a felesleges mátrixszámításokat.
  - **Animált Terep- és Környezetszkennelés:**
    - **3D SurfaceScanner Lézersugár:** Animált ciánkék pásztázó lézer csík halad oda-vissza a felületen, 4 holografikus kiber-sarokrögzítővel és sonár-hullámokkal kiegészítve.
    - **AR HUD Kereső-Viewfinder:** Csúcstechnológiás célkereszt-keret animált fentről-lefelé futó pásztázó lézerrel, pulzáló radar-gyűrűkkel és valós idejű állapotjelző tablettával ("📡 Terep pásztázása..." -> "✨ Felület rögzítve! KOPPINTS...").

---

## 5. Elvégzett Tesztek és Verifikáció
- **3D Render & Fizika:** A Three.js és Cannon-es világ stabil 60 FPS-sel fut, a fizikai lépés és a röppálya-előrejelzés 1:1 szinkronban van.
- **Produkciós build:** `npm run build` hiba nélkül lefutott (15 modul transzformálva, ~531 ms).
- **Fejlesztői szerver:** Elérhető helyben a `http://localhost:5173/` címen.

---
*Utolsó frissítés: 13. Fázis befejezve – UI letisztítás, méretezés finomítása, lag-mentesítés és animált terepszkennelés.*

