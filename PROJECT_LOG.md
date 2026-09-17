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
  - **Fizika:** 30 solver iteráció, zero restitution, 0.95 tapadás, 0.5 mm kőtömb tolerancia az él-ütközések ellen.
  - **Valós becsapódási ébresztés:** A vár kövei nem omlanak össze kilövéskor; csak közvetlen ütközéskor ébrednek fel a becsapódási pont körül.
  - **3D Gumiszalagok és Csúzli:** Valódi térbeli hengeres gumipántok az 1px-es drótok helyett, bőr lövedéktartó fészek, stabil fa talapzat és réz rögzítőgyűrűk.
  - **Prediktív becsapódási célkereszt:** A céljelző pontosan a vár felületére vagy az asztalra vetül.
  - **Geometriai hibajavítás:** Megszűnt az ikertornyok lebegő hídja, az erőd teherhordó kő áthidalóval és stabil bástyafokokkal épül fel, masszív kő talapzat (plinth) a vár alatt.
  - **Procedurális PBR textúrák:** 256x256-os domborzati és kő textúrák, fa gerendák, izzó meteor lövedék.
  - **Asztali 3D Sandbox Mód:** Bármely böngészőben azonnal játszható virtuális fa asztallal és egérrel/érintéssel.
  - **Vizuális effektek:** Kőtörmelék és füstfelhő, gazdag Web Audio szintetizált hangeffektek (feszülés, suhanás, becsapódás, pontszerzés).

---

## 5. Elvégzett Tesztek és Verifikáció
- **3D Render & Fizika:** A Three.js és Cannon-es világ stabil 60 FPS-sel fut, 0 spontán mozgás vagy omlás.
- **Konzol Napló:** 0 hiba és 0 figyelmeztetés a betöltéskor és interakciók során.
- **Böngészős tesztelés (Browser Subagent):** Célzás, hátrahúzás, 3D gumiszalag nyúlás, kilövés, kőomlás becsapódáskor, pontszám növekedés (`PONT: 50`), és az építmények váltása (`Citadel`, `Pyramid`, `Fortress`) sikeresen ellenőrizve.
- **Fejlesztői szerver:** Elérhető helyben a `http://localhost:5173/` címen, illetve helyi hálózaton a telefonos teszteléshez a `http://192.168.0.108:5173/` címen.

---
*Utolsó frissítés: Stabilitási és vizuális felújítás befejezve.*
