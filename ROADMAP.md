# Overreach: roadmap to an 1836 grand strategy game (EU4 / Age of History 3 style)

> **Decided 28 Sep 2026:** the engine is replaced by a fork of OpenFront. The build order is now `SANDBOX.md`
> (F0–F8). From this file, §3 (1836 data) and Appendix A still apply as written. The milestones below map onto
> SANDBOX.md as listed in its §6.

Written 28 September 2026. **This file sets the order of work from here on.** The phase notes in `legacy/HANDOFF.md` §4
(phases 3–11) still hold as the detailed "how"; the milestones below say where each one now goes, and add the
parts that were missing. Read `legacy/HANDOFF.md` §1 (rules), §2 (decided direction), §5 (environment) and §6 (code map) first.

---

## 1. Where the game is today

- A real-time (daily tick) simulation with 5,245 provinces on an 8k map, built by `tools/build_map.py` (in
  `../My Map Game/tools/`, not in this folder).
- It already has an economy (tax, production and manpower development, buildings, loans), armies (infantry,
  cavalry, artillery), battles, sieges, wars with casus belli, war score, peace deals, alliances, opinion,
  aggressive expansion (AE), claims, cores, revolts, an AI and an observer mode.
- Tests: 39/39 in the main suites and 9/9 in `ai:20:check`.
- **The problem the user raised:** the nations are the 241 *modern* countries from Natural Earth, dropped into 1836,
  so the map shows Pakistan, Germany and South Sudan in 1836.

## 2. What "proper EU4 / AoH3 clone" means here: the gaps

| System | Now | Target | Milestone |
|---|---|---|---|
| Countries & borders | 241 modern countries | The world on 1 January 1836: about 250 states, subjects, colonies, unowned land | M1–M4 |
| Nation identity | numeric id, max 255 | tags (`GBR`, `PRU`, `OTT`), no hard cap, flags, historical colours | M1, M4 |
| Country names on the map | none | EU4-style names drawn across each country | M2 |
| Scenario editor | none | paint owners and cores in-game, export (AoH3 has one) | M3 |
| Colonisation & natives | none (every province owned) | unowned land, colonists, native peoples | M5 |
| Coalitions, fort ZoC, pacing | planned (old phase 3) | same, balanced on the 1836 map | M6 |
| Save / load | planned (old 4) | by tag, so saves survive map rebuilds | M7 |
| Stability, prestige, loans, government | planned (old 5) | plus government types | M8 |
| Diplomacy & subjects | planned (old 6) | plus German Confederation, tributaries, releasing nations | M9 |
| Armies, rebels, buildings, navy | planned (old 7) | plus generals, canals by year | M10 |
| Religion, culture, tech, ideas | planned (old 8) | plus nationalism and era-based units | M11 |
| Trade | planned (old 9) | plus trade goods and resources by era (coal, oil, rubber) | M12 |
| Events, decisions, formable nations | none | historical events, decisions such as forming Germany or Italy | M13 |
| EU4-style interface | a side panel and windows | top bar, nation window, outliner, ledger, alerts, tooltips with breakdowns, map modes | M14 |
| Endings, nukes | planned (old 10) | unchanged | M15 |
| Polish | planned (old 11) | unchanged | M16 |
| More start dates | one | 1861, 1871, 1914 and 1936 from the same pipeline | M17 |

Standing decisions from `legacy/HANDOFF.md` §2 still apply: no monarch points, no estates, the timeline runs 1836 → 2036,
and the endings don't change.

---

## 3. The 1836 world: how to get real borders

### 3.1 Why recolouring the current provinces isn't enough
The provinces are cut from **modern** borders and modern admin-1 states. Many 1836 borders run through those units:
- Germany has **46 provinces** today, but the German Confederation had about 39 states.
- Other borders that cross modern units: the partitions of Poland (Posen, Congress Poland, Galicia), Savoy and Nice
  (then Sardinian), Schleswig, Hyderabad, the Texas–Mexico line, and the Afghan–Sikh frontier.

Reassigning whole provinces would give jagged, wrong borders, and the microstates would get no province at all.

**So the map builder cuts provinces along 1836 borders as well as modern ones.** There's a bonus: the modern borders
stay in the geometry, so countries that appear later (Germany, Poland, Yugoslavia, Pakistan, the African states)
have clean borders when they form.

### 3.2 Data source (checked 28 Sep 2026)
The source is **`aourednik/historical-basemaps`, `geojson/world_1815.geojson`**:
- 436 features and 316 named polities.
- `SUBJECTO` names the colonial overlord.
- Licence: **GPL-3.0**.
- It has no 1836 file. The nearest are 1815 and 1878/1880.

What 1815 gets right for 1836:
- Europe's Congress of Vienna settlement, including the German and Italian states.
- Most of Asia.
- Many African kingdoms.

What must be patched for 1836:
- Latin America is still Spanish viceroyalties.
- It shows the Maratha Confederacy, which ended in 1818.
- Hong Kong is shown as British, which only happened in 1841.
- Missing states: Belgium, Greece, autonomous Serbia, Texas and the Sikh Empire.
- Egypt's hold on the Levant (1831–40) and French Algeria (1830) are missing.
- Australia is split into about 150 Aboriginal groups.
- Native American nations are missing.

On the licence: a scenario file derived from this data is GPL too. That's fine for a free game. For a commercial game,
drop the geojson and rely on the hand rules below; they still work, just with coarser borders in a few places.

### 3.3 Pipeline

```
build/world_1815.geojson ─┐
scenario/1836.rules ──────┴─> tools/build_scenario.py ─> build/map8k/hist1836.npy   (1836 polity per pixel)
                                                                  │
Natural Earth (existing) ───> tools/build_map.py stage 2: region key = (modern nation, admin-1, 1836 polity)
                                                                  │
                              stage 4 + scenario stage ─> data/mapdata.js + data/scenario-1836.js
```

1. **Rasterise** the 1815 polities at 7680×3840, reusing `paint()` from `build_map.py`. This gives a polity per pixel.
2. **Apply the 1836 rules** from `scenario/1836.rules`, a plain text file read in order, where the last match wins.
   - A rule selects land by 1815 polity, modern ISO3 code, admin-1 name, a lon/lat box, or a small polygon.
   - **Rules never use province ids**, because ids change on every rebuild.

   ```
   # tag  selector                                   note
   MEX    polity="Viceroyalty of New Spain"
   TEX    admin1="Texas"                             # in revolt on 1 Jan 1836
   UCA    iso3=GTM,HND,SLV,NIC,CRI                   # Federal Republic of Central America
   NGR    iso3=COL,PAN                               # Republic of New Granada
   BEL    iso3=BEL
   GRE    box=19.5,36.3,24.3,39.2                    # Arta–Volos line, 1832
   PUN    admin1="Punjab"@PAK, admin1="Punjab"@IND, polity="Kashmir", town="Peshawar"
   HAI    iso3=HTI,DOM                               # Haiti holds all of Hispaniola, 1822–44
   -      polity~"Australian aboriginal"|<Aboriginal group names>   # '-' = unowned
   ```
3. **Cut the provinces.** In stage 2 of `build_map.py`:
   - The region key becomes (modern nation, admin-1, 1836 polity).
   - Pixels on an 1836 border are walls during growth.
   - The minimum-size merge never crosses an 1836 border.
   - Polities marked `keep` get one province even when small: Hamburg, Bremen, Lübeck, Frankfurt and Kraków.
   - Expect about 5,400–5,700 provinces, which is still under the Uint16 id limit.
4. **Write `data/scenario-1836.js`**, which holds:
   - each province's owner tag and core tags;
   - the nations table;
   - subjects, the confederation, alliances and starting wars;
   - 1836 town names;
   - the `mapHash` it was built against.
5. **Acceptance checks.** These are the one runnable check, and they are what "correct" means:
   - **Town → owner asserts, about 60 of them, e.g.:** Istanbul→OTT, Warsaw→POL (Russian union), Kraków→KRA,
     Poznań→PRU, Lviv→AUS, Milan→AUS, Turin→SAR, Nice→SAR, Rome→PAP, Naples→SIC, Florence→TUS, Brussels→BEL,
     Athens→GRE, Thessaloniki→OTT, Belgrade→SER, Bucharest→WAL, Algiers→FRA, Cairo→EGY, Damascus→EGY, Tunis→TUN,
     San Antonio→TEX, Santa Fe→MEX, Monterey→MEX, Sitka→RUS, Guatemala City→UCA, Panama→NGR, Santo Domingo→HAI,
     Havana→SPA, Lahore→PUN, Peshawar→PUN, Karachi→SND, Hyderabad→HYD, Lucknow→OUD, Kathmandu→NEP, Kabul→AFG,
     Herat→HER, Tbilisi→RUS, Bukhara→BUK, Kashgar→QNG, Vladivostok→QNG, Seoul→KOR, Taipei→QNG, Hanoi→DNA,
     Phnom Penh→DNA, Bangkok→SIA, Yangon→BUR, Singapore→GBR, Jakarta→NED, Manila→SPA, Honolulu→HAW, Sydney→GBR,
     Auckland→MAO, Cape Town→GBR, Antananarivo→MER, Kumasi→ASH, Sokoto→SOK, Helsinki→FIN, Oslo→NOR.
   - Every nation has at least one province, and its capital is inside it.
   - Rough area checks for Russia, the US, Mexico, the Qing and the Ottomans.

### 3.4 Who owns what (defaults: see §6 to change them)
- **Owned:** land a state ran or whose sovereignty other powers recognised. The US to the Rockies, Mexico's north,
  Russian Alaska, Hudson's Bay Company land and Qing Outer Manchuria count. So the political map matches period maps.
  The frontier shows up as low population and development, and as native unrest.
- **Unowned (open to colonists):**
  - land nobody claimed, or held only by stateless peoples: interior Africa between the kingdoms, Australia beyond the
    settled districts, Patagonia, New Guinea, the Amazon interior and the Arctic islands;
  - disputed land, e.g. the Oregon Country, where both the US and Britain get a claim.
- **Tribal nations** (playable and weak, like AoH3's uncivilised states) where a people held defined land with a
  political centre: Comanche, Lakota, Seminole, Mapuche, Māori (United Tribes, 1835), Zulu, Ndebele, Basotho, Xhosa,
  and the Caucasian Imamate.

### 3.5 Subjects, leagues, alliances and wars on 1 January 1836
- **Personal unions:**
  - UK–Hanover (it ends in June 1837, so it can be an event)
  - Sweden–Norway
  - Netherlands–Luxembourg
  - Russia–Finland and Russia–Poland (Congress Poland)
- **Vassals and tributaries:**
  - **Ottoman Empire:** Serbia, Wallachia, Moldavia, Tunis and Egypt. Egypt is nominally a vassal, but it holds the
    Levant, the Hejaz, Crete and the Sudan and has very high liberty desire, which sets up the 1839 war.
  - **East India Company** (itself a British company subject): Hyderabad, Oudh, Mysore, Travancore, Gwalior, Indore,
    Baroda, Nagpur, Bhopal and the Rajput states.
  - **Qing tributaries:** Korea, Ryukyu and Nepal.
  - **Siam:** Luang Prabang, Champasak and the northern Malay sultanates.
  - **Đại Nam:** Cambodia, which it annexed in 1834.
  - **Britain:** the Ionian Islands.
- **German Confederation:** a league object with Austria as president and about 25 members (see Appendix A). Its
  mechanic comes in M9.
- **Alliances:**
  - The Holy Alliance of Russia, Austria and Prussia (Münchengrätz, 1833).
  - The Quadruple Alliance of Britain, France, Spain and Portugal (1834).
- **Wars already running**, so the game starts with action:
  - The Texas Revolution: Texas vs Mexico.
  - The First Carlist War: Spain vs Carlist rebels in Navarre and the Basque lands.
  - Santa Cruz's war in Peru: Bolivia vs Salaverry's Peru, which leads to the Peru–Bolivian Confederation later in 1836.
  - France vs Abdelkader's emirate in Algeria.
  - Russia vs the Caucasian Imamate.
  - The Second Seminole War: the US vs the Seminole.

### 3.6 Names that fit the date
- **Town names over time.** `scenario/names.txt` maps modern names to historical ones with year ranges, e.g.
  Istanbul → Constantinople (until 1930), Mumbai → Bombay, Chennai → Madras, Kolkata → Calcutta, Tokyo → Edo (until 1868),
  Jakarta → Batavia, Oslo → Christiania, Helsinki → Helsingfors, Gdańsk → Danzig, Wrocław → Breslau,
  Kaliningrad → Königsberg, Lviv → Lemberg, Bratislava → Pressburg, Tallinn → Reval, Volgograd → Tsaritsyn,
  Ho Chi Minh City → Saigon, and St Petersburg → Petrograd (1914) → Leningrad (1924) → St Petersburg (1991).
  The name follows the game date.
- **Towns founded after 1836** stay hidden until their founding year, and the province shows its regional name until
  then. This needs a hand list of the ~150 largest, e.g. Johannesburg 1886, Nairobi 1899, Kinshasa 1881,
  Vladivostok 1860, Almaty 1854, Canberra 1913, Tel Aviv 1909 and Brasília 1960.
- **Country names change by event** (Prussia → German Empire) in M13.

---

## 4. Architecture changes (M1)

**Move nations out of the map.**
- `World` keeps the geometry. The modern-country column becomes the **homeland layer**: the 241 modern countries are
  now *future* nations for nationalism, releases, formables and decolonisation.
- A scenario file brings the date's nations:
  - `World.useScenario(SCENARIO)` fills `NAT`, `IDS` and `CAPITAL` from the scenario.
  - It adds `W.startOwner(i)`, `W.cores(i)` and `W.homeland(i)`.
  - `Engine.newGame` reads `W.startOwner(i)` where it now reads `W.nationOf(i)` (engine.js:218).
- Almost everything else only calls `W.nation(id)`, `W.nations()`, `W.colour(id)` or `W.capital(id)`, so it keeps working.

**Tags, and no cap on nation count.**
- Data files and saves use 3-letter tags. Numeric ids are assigned at load.
- Arrays are sized to the scenario (`NN = nations + 2`), not to 256. Nation-id arrays move from `Uint8Array` to
  `Uint16Array`.
- Where the cap is hard-coded: engine.js (27 uses of `256`, 15 `Uint8Array`), ai.js (3, 1), world.js (3 `Uint8Array`),
  index.html (1, 4) and tests/worker.js.
- Opinion, truce and insults stay dense N×N tables: at about 500 nations that is 250k cells, which is fine.
- The rebel id becomes `NN − 1`, not 255.

**Refactor-safety check.** A "modern" scenario generated from today's `mapdata.js` (owner = `nationOf`) must give:
- 39/39 and 9/9;
- a byte-identical hash of owner, control and population after 20 years on seed `1836`, before and after the refactor.

That proves the refactor changed nothing. After that, add a check with a synthetic 600-nation scenario.

---

## 5. Milestones (in order)

Each milestone follows the `legacy/HANDOFF.md` rules: write the failing check first, measure before and after, publish after
each one, and ask the user to open the game after visible changes.

### M0: Housekeeping (short)
1. **`git init` and a first commit.** M1 touches about 50 lines across 5 files, so there needs to be a way back. There's
   no version control today.
2. **One project folder.** Move `tools/` and `build/` from `../My Map Game/` into `Overreach/` and fix `OUT` in
   `build_map.py:28`. `My Map Game/overreach/` matches this folder except for whitespace in `index.html`
   (checked 28 Sep). Ask the user before deleting it.
3. Serve the folder with `python -m http.server 8766`, then confirm 39/39 and 9/9.

### M1: Nation layer: tags, scenario loader, no nation cap
As in §4.
- **Checks first:** the modern-scenario hash is equal before and after; a 600-nation scenario loads and runs a year;
  a save-free tag lookup round-trips.
- **Done when:** all suites pass, and speed is ≤ 4 ms a day on the modern scenario.

### M2: 1836 borders and country labels
Build `tools/build_scenario.py`, `scenario/1836.rules` and the stage-2 cut (§3.3), then the asserts (§3.3.5).

**Country names on the map** are the biggest single "this is EU4" win:
- Fit a curve through each nation's province centroids along its main axis (weighted by area), and size the text to the
  country's extent.
- Recompute only for nations whose borders changed.
- Hide the label below a size threshold.

**Done when:**
- the asserts pass;
- the user signs off Europe, the Americas, India and Africa on screen;
- speed is under 12 ms a day with about 250 nations;
- the old baselines are retired, because they were measured on the modern world.

### M3: Scenario editor (AoH3-style)
- An editor mode that paints province owner or cores with a tag picker and edits the nations table (name, colour,
  capital).
- **Export** writes rule lines (`TAG town="…"` or `TAG point=lon,lat`), never province ids, which get appended to
  `scenario/1836.rules`. Fixes then survive map rebuilds.
- This is how border complaints get fixed without code.
- **Done when:** a painted fix survives a full map rebuild.

### M4: 1836 world content
- **Nations table:** tag, name, colour, flag, government, primary culture, religion, tech group, capital town.
  - Colours: hand-pick about 60 EU4-style ones for the majors (France blue, Britain red, Russia green, Prussia
    grey-blue, Austria white, Ottomans teal) and keep the builder's colours for the rest.
- **Subjects, the German Confederation, alliances and starting wars** as in §3.5, plus cores:
  - the 1836 owner;
  - lost lands, e.g. Mexico on Texas and Persia on Herat;
  - homeland claims where they fit.
- **Peoples data** (moved forward from old phase 8): culture and religion per province, set by rules like the borders.
- **1836 population.** Today's population is modern GeoNames data, so development is wrong for 1836.
  - Scale each country's modern distribution to its 1836 total, using a table interpolated from Maddison Project 1820
    and 1850 figures (~1.1 billion people in the world).
  - Use HYDE 3.2's gridded 1830/1840 population only if a region looks wrong, e.g. the American West or Siberia.
    Check the licence when downloading it.
  - Starting development, forts and armies then come from 1836 population.
- **Flags:**
  - A tiny spec per nation (`tricolour-v`, `tricolour-h`, `nordic-cross`, `canton`, `plain+emblem`) drawn on canvas.
  - Hand specs for about 80 nations. The rest get a plain field with the tag as a monogram.
  - No copied image assets.
- **Done when:** the Ottomans, Egypt, the East India Company, the Qing and Britain show their subjects in the panel;
  every starting war appears in the dispatches on day 1; and the flags render.

### M5: Unowned land, natives, colonisation
- **Owner 0 means unowned.** The engine has to accept it in `refreshEconomy`, `canEnter`, painting and AI targeting:
  - armies may cross it and take attrition;
  - it pays no income and needs no siege.
- **Native population and aggressiveness** per province, set by rules.
- **Colonists:**
  - one per nation, plus one per colonial tech;
  - they cost ducats;
  - the colony grows to 1,000 settlers in about 3 years, slower the further it is from an owned port;
  - native uprisings can hit it;
  - the province becomes normal land when the colony completes.
- **The AI colonises** by reach from the coast.
- **Checks:**
  - A colony completes.
  - Unowned land pays nothing.
  - Natives raid a weak colony.
  - An 80-year AI run claims most of Africa by about 1900. This one is a soft target.

### M6: Pacing and balance (old phase 3)
Coalitions, fort zones of control, fast occupation of unfortified land, and world share by true area, on the 1836 map.
Keep the old targets, but measure on 1836 nations (e.g. "no AI passes 15% of the world's true area", "coalitions win most of their wars"),
and save the result as `tests/baseline-m6.json`.

### M7: Save and load (old phase 4)
As planned, with two changes:
- The save header carries the scenario id plus `mapHash`.
- Nations are stored by tag, so a save refuses to load on another map instead of silently mixing nations.

### M8: The do-nothing numbers, plus government (old phase 5)
Stability, prestige, loan caps, bankruptcy, claim timers, difficulty and universities, as planned. On top of that:
- **Government types:** absolute monarchy, constitutional monarchy, republic, theocracy, tribal and chartered company.
  Each carries small modifiers (stability, AE, ally cap, unrest).
- Reforms that come with later eras belong to M11 and M13.

### M9: Diplomacy and subjects (old phase 6)
Everything planned for old phase 6, plus:
- **German Confederation:** members get a defensive call to arms against outsiders. Austria and Prussia compete for the
  presidency. It dissolves on a war between members' leaders or when Germany forms (M13). This is HRE-lite.
- **Tributaries:** no annexing, an opinion bond and a yearly payment. They can break away when the overlord is weak.
- **Chartered-company subjects,** e.g. the East India Company: integration by event, as with the Government of India Act.
- **Release a nation from the homeland layer,** EU4-style, as a vassal or as free.

### M10: Armies, rebels, buildings, navy (old phase 7)
As planned, plus:
- **Generals** (fire, shock, manoeuvre and siege pips, drawn from army tradition).
- **Canals by year:** Suez 1869, Kiel 1895 and Panama 1914 as navy data.

### M11: Religion, culture, technology, ideas (old phase 8)
The data already exists from M4, so this is mechanics only. Plus:
- **Nationalism:** provinces whose homeland differs from the owner build separatism, which feeds revolts and
  independence wars. This is how the 1836 map turns into something like the modern one by 2036 without scripting it:
  Belgium's model, the Balkans, Latin America, then decolonisation.
- **Era units:** infantry, cavalry and artillery stats scale by era (line infantry → rifles → machine guns → armour),
  so an 1836 army can't beat a 1950 army.

### M12: Trade and goods (old phase 9)
Trade nodes as planned, plus a **trade good per province**:
- Goods: grain, livestock, wool, cotton, sugar, coffee, tea, tobacco, spices, silk, timber, fish, iron, coal, copper,
  gold, oil and rubber.
- Prices change by era: coal matters from Railways, oil from the Machine Age, rubber from 1890.
- Add a goods map mode. The Monopoly metric is unchanged.

### M13: Events, decisions, formable nations (new)
- **Event engine:** `data/events-1836.js` holds `{id, after, before, who, trigger(s,id), title, text, options:[{label, effect(s,id)}]}`.
  - Triggers are plain JS functions, not a scripting language.
  - The AI picks options by weight.
  - The player gets a popup that pauses the clock.
- **Historical pressure, not a script.** An event fires only if the world still fits it. Examples: Hanover's union ends
  (1837), the Opium War crisis, the Oregon partition, the Mexican–American War, the 1848 revolutions, the Crimean War
  crisis, the Meiji Restoration, the emancipation of the serfs, Suez, the Berlin Conference, and later-era crises.
- **Decisions and formables** use the homeland layer as the target territory: form X when you own at least 70% of X's
  homeland and meet the conditions.
  - Germany (lead the Confederation), Italy, Romania (Moldavia + Wallachia), Canada (colonial self-rule), Yugoslavia.
  - Reforms: Japan's Meiji reforms (tech group), Ottoman Tanzimat, Qing Self-Strengthening.
- **Random events:** harvests, epidemics, gold rushes (California in 1848 if owned) and inventions.

### M14: EU4-style interface (new)
- **Start screen:** the bookmark (date and a short blurb), click the map to pick a nation, recommended nations with flag
  and difficulty.
- **Top bar:** treasury (with the monthly change), manpower, stability, prestige, AE, war exhaustion, colonists, date and speed.
- **Nation window** with tabs: Overview, Economy, Military, Diplomacy, Subjects, Technology & Ideas, Religion & Culture.
  **Province window** with tabs.
- **Outliner:** armies, fleets, sieges, colonies and wars.
- **Alerts row,** as in EU4: idle colonist, army out of supply, near bankruptcy, rebels about to rise, better relations
  possible.
- **Every number gets a tooltip with its breakdown,** e.g. "Income 12.4 = tax 6.1 + production 4.0 + trade 2.3".
  This is EU4's defining feature. The engine returns breakdown objects and the UI only prints them.
- **Ledger:** ranking tables plus history graphs (history comes from M15).
- **Map modes:** political, terrain, diplomatic, religion, culture, development, goods, supply, unrest, colonial range,
  claims, subjects/confederation. Each must stay cheap (see `legacy/HANDOFF.md`, "Repaints are about 10× faster").
- **Hotkeys:** Space pauses, 1–5 set the speed, plus windows and map modes.

### M15: Endings, nukes, game flow (old phase 10), unchanged

### M16: Polish (old phase 11), unchanged

### M17: More start dates
- Bookmarks in 1861, 1871, 1914 and 1936 use the same pipeline: `world_1880`, `world_1914` and `world_1938` as bases,
  plus rule deltas.
- **Province cuts must be the union of every bookmark's borders,** so build all bookmark geometry in one rebuild.
  That changes province ids once, so rerun every suite. The rules never use ids, so every scenario regenerates cleanly.

---

## 6. Decisions for the user (the default applies if they don't say)

1. **Start date:** 1 January 1836, with the Texas Revolution, Carlist War and Peru–Bolivia war running.
   The alternative is 2 March 1836, when Texas is already independent.
2. **Frontier:** land with recognised sovereignty is owned, so the US runs to the Rockies. Stateless land is unowned and
   open to colonists, including interior Australia despite Britain's 1829 claim.
3. **Natives:** about 10–15 tribal nations where they held defined land, and native population on unowned land elsewhere.
4. **German Confederation:** about 25 states, with the tiny Thuringian, Anhalt, Reuss and Schwarzburg lines grouped.
5. **India:** the East India Company plus the ~15 largest princely states as vassals, not all 560.
6. **GPL-3.0 border data:** fine while the game is free.
7. **More start dates later (M17):** yes.

## 7. Risks
- **Speed with ~250 nations.** Measure in M1 with the synthetic 600-nation scenario. The AI rota already spreads the work.
- **Province ids change on every rebuild.** Tests and rules must pick provinces by town name or point, never by id.
- **Historical accuracy is a rabbit hole.** The asserts list defines "correct". Anything else goes through the editor (M3)
  when the user reports it.
- **Memory (8 GB).** The polity raster is 7680×3840 Uint16, which is 59 MB. That's fine, but keep the builder's rule of
  no whole-map index arrays.

---

## Appendix A: 1 January 1836 checklist (verify each against sources in M2; about 230–260 nations)

**Europe**
- **Great powers:**
  - Britain (plus Hanover in union, the Ionian Islands, Malta)
  - France (the July Monarchy, plus coastal Algeria)
  - Russia (plus Finland and Poland in union, Bessarabia, the South Caucasus, Alaska)
  - Austria (with Hungary, Lombardy–Venetia, Galicia and Dalmatia)
  - Prussia (with Posen, the Rhineland, Westphalia and Neuchâtel)
  - The Ottoman Empire
- **Other states:**
  - Spain (at war with the Carlists) and Portugal
  - The Netherlands (with Luxembourg in union, and still claiming Belgium) and Belgium
  - Switzerland
  - Denmark (with Schleswig, Holstein, Lauenburg, Iceland, the Faroes and Greenland)
  - Sweden and Norway (in union)
  - Greece
  - Serbia, Wallachia and Moldavia (Ottoman vassals)
  - Montenegro
  - The Free City of Kraków
- **Italy:** Sardinia (Piedmont, Liguria, Savoy, Nice and Sardinia), Parma, Modena, Lucca, Tuscany, the Papal States and
  the Two Sicilies.
- **German Confederation (about 25):**
  - Bavaria, Württemberg, Baden, Saxony and Hanover
  - Hesse-Kassel, Hesse-Darmstadt and Nassau
  - Brunswick, Oldenburg, Mecklenburg-Schwerin and Mecklenburg-Strelitz
  - Saxe-Weimar and the Saxon duchies (grouped)
  - Anhalt, Lippe, Waldeck and Hohenzollern
  - The free cities: Hamburg, Bremen, Lübeck and Frankfurt
  - Plus the Austrian, Prussian, Danish (Holstein) and Dutch (Luxembourg) member lands

**Americas**
- **United States:** 24 states, plus the Michigan, Arkansas and Florida territories and unorganised land to the Rockies.
- **Texas,** in revolt.
- **Mexico,** including California, New Mexico and Yucatán.
- **Central America:** the federation (Guatemala, Honduras, El Salvador, Nicaragua and Costa Rica).
- **British possessions:** Upper and Lower Canada, the Maritimes, Newfoundland, Rupert's Land (Hudson's Bay Company),
  British Honduras, Jamaica and the islands, British Guiana, and the Falklands.
- **Russian Alaska.**
- **The Oregon Country:** disputed and unowned.
- **Caribbean:**
  - Haiti (all of Hispaniola)
  - Spanish Cuba and Puerto Rico
  - French, Dutch, Danish and Swedish islands
- **South America:**
  - New Granada (with Panama), Venezuela and Ecuador
  - Peru and Bolivia
  - Chile
  - The Argentine Confederation
  - Uruguay and Paraguay
  - The Empire of Brazil (with the Ragamuffin and Cabanagem revolts)
  - British, Dutch and French Guiana
- **Tribal:** Comanche, Lakota, Seminole and Mapuche. Patagonia is unowned.

**Africa**
- **North:**
  - Morocco
  - Abdelkader's emirate (the western interior) and the Beylik of Constantine (the eastern interior, until 1837)
  - French coastal Algeria
  - Tunis (an Ottoman vassal)
  - Ottoman Tripolitania
  - Egypt, with the Sudan to Sennar and Kordofan
- **West:**
  - Futa Toro, Futa Jallon, Kaarta, Ségou and Massina
  - Kong and the Mossi states
  - Ashanti and Dahomey
  - Oyo (collapsing) and Benin
  - The Sokoto Caliphate, Bornu, Bagirmi, Wadai and Darfur
  - Liberia (an American colony)
  - European forts and colonies:
    - France: Saint-Louis and Gorée
    - Britain: the Gambia, Sierra Leone and the Gold Coast
    - Portugal: Guinea
    - The Netherlands: Elmina
    - Denmark: Christiansborg
- **Central:** Kongo, Loango, Kasanje, Lunda, Luba, Kazembe, Kuba and Lozi, plus the Portuguese coast of Angola.
- **East:**
  - Ethiopia (divided in the Zemene Mesafint era) and Shewa
  - Harar and Kaffa
  - Oman's Swahili coast
  - Buganda, Bunyoro, Rwanda, Burundi and Karagwe
  - The Portuguese coast of Mozambique
  - Merina and the Sakalava on Madagascar
- **South:**
  - Cape Colony (British)
  - Xhosa, the Zulu kingdom, Mthwakazi (the Ndebele), the Basotho and the Swazi
  - The Griqua states and the Gaza Empire

**Asia**
- **Middle East:**
  - The Ottoman Empire (Anatolia and Iraq)
  - Egypt (the Levant and the Hejaz)
  - Nejd (the Second Saudi State)
  - Yemen and Lahej (Aden becomes British only in 1839)
  - Oman (Muscat and Zanzibar)
  - The Trucial sheikhdoms and Bahrain
  - Qajar Persia
- **Central Asia:**
  - Khiva, Bukhara and Kokand
  - The Kazakh hordes (partly Russian)
  - Turkmen tribes
  - Kabul (Dost Mohammad), Herat and Kandahar
  - Kalat
- **South Asia:**
  - The East India Company (the three presidencies, the North-Western Provinces, Arakan, Tenasserim and Assam)
  - The Sikh Empire (with Kashmir, Peshawar, Multan and Ladakh)
  - Sindh (the Talpur Mirs, until 1843) and Bahawalpur
  - Company vassals: Hyderabad, Oudh, Mysore, Travancore, Gwalior, Indore, Baroda, Nagpur, Bhopal and the Rajput states
  - Nepal, Bhutan and Sikkim
  - Ceylon (British)
- **East Asia:**
  - The Qing Empire, with Outer Manchuria, Mongolia, Xinjiang and Taiwan, and Tibet as a protectorate
  - Korea and Ryukyu
  - Tokugawa Japan
  - Portuguese Macau
- **Southeast Asia:**
  - Burma
  - Siam and its tributaries
  - Đại Nam (with Cambodia)
  - Johor, Pahang, Perak, Selangor, Terengganu and Kelantan
  - The British Straits Settlements
  - Aceh
  - The Dutch East Indies
  - The Balinese kingdoms
  - Brunei (with Sarawak until 1841)
  - Sulu and Maguindanao
  - The Spanish Philippines and Portuguese Timor

**Oceania**
- British settled districts: New South Wales, Van Diemen's Land and the Swan River. Aboriginal land is unowned.
- The Māori United Tribes, Hawaii, Tahiti, Tonga (chiefdoms), Fiji (Bau) and Samoa.
- New Guinea is unowned.
