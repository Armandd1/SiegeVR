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
| 2026-09-16 | Méretezés és lehelyezési logika | Egész szobás vs. Kompakt asztali méret, Együttes vs. Külön lehelyezés | **Kompakt Asztali Méretarány + 2 Lépcsős Elhelyezés** | A blokkok mérete 8x5x5 cm-re csökkentve (kényelmes asztali méret). Külön lépésben kerül lehelyezésre a Vár és a Csúzli az asztal tetszőleges pontjaira, automatikus célrafordulással. |
| 2026-09-16 | Csúzli és Célzás mechanika | Képernyőérintés vs. Kézi húzás & röppálya | **Kézi húzás valós idejű 3D trajektóriával** | A golyó hátrahúzásakor a fizikai gravitációval számolt pontozott 3D ív kirajzolódik a célpontig, elengedésre kirepül és rombol. |

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
- [x] **8. Fázis:** Asztali méretarány és fizikai finomhangolás (stabil téglák, alvási mechanizmus, dinamikus 3D trajektória).
  - Bekapcsolt alvási mechanizmus (`allowSleep = true`, `sleepSpeedLimit = 0.1`): a blokkok mozdulatlanok maradnak, nincs spontán eldőlés.
  - Megnövelt súrlódás (`friction: 0.8`) és csillapított mikromozgások.
  - **4 különböző random építmény típus**:
    1. *Fortress:* Erődített várfal bástyákkal és kapuval.
    2. *Pyramid:* Zikkurat / lépcsős piramis széles, szilárd alappal.
    3. *Twin Towers:* Két magas bástyatorony összekötő függőhíddal.
    4. *Monolith:* 3D tömör kőerőd belső kamrával.

---

## 5. Elvégzett Tesztek és Verifikáció
- **3D Render & Fizika:** A Three.js és Cannon-es világ stabil 60 FPS-sel fut.
- **Konzol Napló:** 0 hiba a betöltéskor és az interakciók során.
- **Gombok tesztje:** Az "Újraépítés" és a "Portál" funkciók hibátlanul működnek.
- **Fejlesztői szerver:** Elérhető helyben a `http://localhost:5173/` címen, illetve helyi hálózaton a telefonos teszteléshez a `http://192.168.0.108:5173/` címen.

---
*Utolsó frissítés: Projekt inicializálása.*
