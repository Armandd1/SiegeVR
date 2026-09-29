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
- [x] **10. Fázis:** Teljes Rendszerszintű Finomítás és Tisztítás:
  - **Szemétgyűjtő (GC) és Memóriaprofil:** `updateScore()` és `phonePull` 0 memóriafoglalásra optimalizálva (`tempUpVector`, `tempCamDelta`), füstrészecskék klónozott anyagainak azonnali `dispose()`-ja.
  - **Maradék lövedékek kezelése (`clearAllProjectiles`):** Vár újraépítésekor, elrendezésváltáskor és újrakezdéskor a játéktéren heverő korábbi lövedékek automatikusan törlődnek, kizárva a téglákkal való ütközési glitch-eket.
  - **Biztonsági impulzus-számítás:** Becsapódási sebességvektor normalizálása 0 sebesség esetén védett, megelőzve a NaN értékeket.
  - **Kamera-elérési robusztusság:** Natív `getUserMedia` fallback beépítése arra az esetre, ha a külső `@mediapipe/camera_utils` nem töltődne be.
  - **Web Audio késleltetés megszüntetése:** Automatikus AudioContext aktiválás az első felhasználói koppintásra mobil böngészőkön.

---

## 5. Elvégzett Tesztek és Verifikáció
- **3D Render & Fizika:** A Three.js és Cannon-es világ stabil 60 FPS-sel fut, 0 spontán mozgás vagy omlás.
- **Konzol Napló:** 0 hiba és 0 figyelmeztetés a betöltéskor és interakciók során.
- **Böngészős tesztelés (Browser Subagent):** Célzás, hátrahúzás, 3D gumiszalag nyúlás, kilövés, kőomlás becsapódáskor, pontszám növekedés (`PONT: 50`), és az építmények váltása (`Citadel`, `Pyramid`, `Fortress`) sikeresen ellenőrizve.
- **Produkciós build:** `npm run build` hiba nélkül, sikeresen lefut (Vite v8.3.0).
- **Fejlesztői szerver:** Elérhető helyben a `http://localhost:5173/` címen, illetve helyi hálózaton a telefonos teszteléshez a `http://192.168.0.108:5173/` címen.

---
*Utolsó frissítés: Teljes rendszerszintű optimalizálás és finomítás befejezve.*
