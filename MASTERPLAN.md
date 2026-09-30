# Overreach masterplan: from an OpenFront fork to a grand strategy game

Written 30 September 2026, after F0–F8 (`SANDBOX.md`). This file sets the order of work from here on. `ROADMAP.md` §3
(the 1836 data rules) and Appendix A still hold; its milestones M8–M17 are folded in below. The owner's pending items in
`HANDOFF.md` (push, deploy, go public, npm 12) are unchanged.

---

## 1. The game

**Overreach is a grand strategy game of 1836–2036, played on OpenFront's real-time tile engine.**

- **1836 is Victoria 2's start date, not EU4's** (EU4 ends in 1821). So "the mechanics of other grand strategy games"
  means:
  - **Victoria:** great powers, prestige, spheres of influence, industrialisation, crises, colonisation, reforms and
    nationalism;
  - **EU4:** the interface and the war system (casus belli, war score, peace deals, aggressive expansion, coalitions, map
    modes, tooltips that explain every number);
  - **Hearts of Iron:** the 20th century (ideologies, factions, world tension);
  - **Age of History 3 and Ages of Conflict:** the sandbox side (scenario editor, custom nations, civil wars, watching the
    world play itself, history and statistics).
- **The military stays OpenFront's:** troops per nation, fronts that push tile by tile, the attack-ratio slider, boats,
  structures, and nukes in the atomic era. There are no armies to move, no generals and no supply lines.
- **Every grand-strategy system plugs into OpenFront through a few numbers:** gold income, troop cap, troop growth,
  attack and defence strength, and what may be built. Government, stability, technology, war exhaustion, events and goods
  are all modifiers on those numbers (§5.1). That gives EU4 depth without rewriting OpenFront's combat.

## 2. Decisions this plan makes (the default applies unless you say otherwise)

| #   | Decision                  | Default                                                                                                                                                                                                                                                                                                                       | Alternative                                                                              |
| --- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | What we keep of OpenFront | **The engine:** `src/core`, the WebGL renderer, the worker, `LocalServer`, the server (for multiplayer later) and the map generator. Their shell (home page, store, accounts, clans, ranked, ads, Steam, cosmetics, news, streams: about 100 files, 33k of the client's 121k lines) and 129 of their 130 maps get **deleted** | Keep hiding them: cheap merges, but the dead code stays and the static site stays 638 MB |
| 2   | Base map                  | Our own **Earth** map: 5,632 × 2,160 tiles, equirectangular from 80°N to 58°S, built from Natural Earth and ETOPO. About 3.8M land tiles, 5.8× today's                                                                                                                                                                        | 5,120 (3.1M) or 6,144 (4.5M) wide, picked by G1's speed test                             |
| 3   | Conquest                  | Provinces taken in a war are **occupied**. They change owner only in the peace treaty                                                                                                                                                                                                                                         | OpenFront's instant ownership (today)                                                    |
| 4   | Clicks                    | Left click selects (province and nation windows); right click opens the action wheel (attack, boat, build, diplomacy)                                                                                                                                                                                                         | OpenFront's left-click attack, kept as a setting either way                              |
| 5   | Genre anchor              | Victoria-style systems with an EU4-style interface. Monarch points and estates stay out (`legacy/HANDOFF.md` §2)                                                                                                                                                                                                              | EU4-style systems                                                                        |
| 6   | Start dates (bookmarks)   | 1836, 1861, 1871, 1885, 1914, 1936, 1962                                                                                                                                                                                                                                                                                      | Fewer                                                                                    |

**Decision 1 changes `SANDBOX.md` §4 rule 3** ("hide, don't delete"):

- The client we'd keep hiding is the part §4 replaces, so merging upstream's interface changes buys nothing. The engine is
  what we want from upstream, and the one-line-hook rule stays for `src/core` and the renderer.
- For merges, a file we deleted that upstream changed is resolved by keeping it deleted (`git rm`). A short script does
  that.
- Other languages' translation files stay: `CLAUDE.md` forbids editing them, and Crowdin manages them.

---

## 3. The map

### 3.1 Which map

Today World 1836 is a scenario on OpenFront's World map: 2,000 × 1,000 tiles, 652k of them land. A tile in central Europe
is about 20 km tall and 13 km wide, so Saxony gets ~60 tiles, Luxembourg ~10 and Frankfurt none.

The candidates, with land tiles measured on the legacy 7,680 × 3,840 terrain raster
(`../My Map Game/build/map8k/terrain.npy`):

| Map                        | Tiles       | Land tiles | × today | Saxony | Luxembourg | Notes                                                                                                                     |
| -------------------------- | ----------- | ---------- | ------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| OpenFront World (today)    | 2000 × 1000 | 0.65M      | 1       | ~60    | ~10        |                                                                                                                           |
| OpenFront Giant World      | 4108 × 1948 | 2.34M      | 3.6     |        |            | In the repo and played online, but its manifest has no geographic bounds, so every dataset would first need fitting to it |
| Earth 5120, 80°N–58°S      | 5120 × 1963 | 3.1M       | 4.8     | ~380   | ~65        | Right at the map generator's recommended maximum of 3M land tiles                                                         |
| **Earth 5632, 80°N–58°S**  | 5632 × 2160 | 3.8M       | 5.8     | ~460   | ~80        | EU4's map is also 5,632 wide. Hamburg gets ~12 tiles, Frankfurt a few                                                     |
| Earth 6144, 80°N–58°S      | 6144 × 2355 | 4.5M       | 6.9     | ~550   | ~95        |                                                                                                                           |
| Legacy raster, whole globe | 7680 × 3840 | 9.9M       | 15      |        |            | 3× the recommended maximum. Antarctica alone is ~3M tiles                                                                 |

- **"The largest and most detailed" is limited by tile count, not by the source.** Natural Earth's 1:10m land and lakes
  (public domain, already used by the legacy builder) are finer than a 7 km tile. OpenStreetMap's coastline would add
  nothing at this size.
- **Cropped at 80°N and 58°S:** that drops Antarctica and the high Arctic, which have no part in the game. It keeps
  Siberia's whole Arctic coast (Taymyr reaches 77.7°N), Greenland to 80°N and Cape Horn (56°S).
- **Equirectangular:** every source is in longitude and latitude, so rasterising is a scale and an offset. The legacy
  builder and `build_1836.py` already work this way. It stretches the north as today's map does: a tile at 60°N covers
  half the ground of one on the equator. Miller (EU4-like) stretches more, and an equal-area projection would shrink
  Europe, the opposite of what we want.

### 3.2 What the Earth map carries

- **Terrain:** elevation (ETOPO 2022, NOAA, public domain, or the legacy raster) mapped to OpenFront's blue-channel key
  for plains, highlands and mountains.
- **Impassable ice:** Greenland's ice sheet and the highest ranges become impassable tiles. The engine already has
  `isImpassable`, and attacks and nukes respect it.
- **A painted relief image:** Natural Earth II with shaded relief (public domain, 21,600 × 10,800), cut and scaled to
  the map. OpenFront already draws a full-size image between terrain and territory (`MapLayerPass`, used by the China
  map), so the EU4 painted-terrain look costs no engine code.
- **Our own layers, like provinces:**
  - terrain type (forest, jungle, desert, steppe, marsh, tundra) from RESOLVE Ecoregions 2017 (CC BY 4.0);
  - rivers from Natural Earth, as crossing penalties. They aren't water tiles, because water would cut every front in
    two.

  Both are data in G1 and start to matter in G5.

- **Canals:** Suez, Kiel and Panama start as land. G5 digs them on their dates through `setWater`, the function water
  nukes use.

### 3.3 Pipeline

```
tools/overreach/build_earth.py ─> map-generator/assets/maps/earth/{image.png, info.json, relief layer}
                                  └─> go run . --maps=earth ─> resources/maps/earth/
tools/overreach/build_1836.py (any map bounds) ─> resources/scenarios/world-1836.json on Earth
```

- **Provinces:** the legacy 5,245-province raster, sampled _down_ from its native 7,680 width (today it's sampled up),
  and cut by the borders of every start date at once (§6), so province shapes never change again when bookmarks arrive
  (ROADMAP M17). That's about 5,400 provinces of ~700 tiles each, instead of ~120.
- **Population:** HYDE 3.3's 1830 and 1840 grids (5 arc-minutes, Utrecht University, open), summed per province and
  interpolated to 1836. This replaces the single world factor of 0.137 (ROADMAP §3.6) with real regional populations.
- **Names:** historical town names with their dates from Wikidata (official names with start and end dates, CC0),
  checked against Wikipedia's list of city name changes. Towns founded after the game date stay hidden.

### 3.4 Cost, measured before anything is built on it

- **Memory:** each tile holds 1 byte of terrain, 2 of state and 4 of provinces, in the worker and again in the client.
  At 12.2M tiles that's roughly 85 MB a side, plus GPU textures. That should fit in 8 GB; the test measures it.
- **Download:** `map.bin` is 1 byte a tile (12 MB), plus the relief image (WebP, a few MB). With the other 129 maps
  gone, the static site drops from 638 MB to roughly 50 MB.
- **Speed:** F2 measured 250 nations on World at 4.0 ms a tick (5.6 ms with F6). Attacks scale with border length (about
  2.4× longer); some passes scale with tile count (5.8×). Nobody knows the total until it's measured, so G1 starts with a
  speed test at three sizes.
- **Pace:** fronts move a tile at a time, so crossing a country takes ~2.4× the ticks. That slows wars, which the game
  wants, but expansion and boats need retuning in G3.

---

## 4. The interface

### 4.1 What's wrong today

- **It looks and plays like an .io game:** OpenFront's leaderboard, a troops-and-gold bar with the attack slider at the
  bottom, a name box with a troop count on every nation, a radial menu for everything, and OpenFront's home page and
  lobby.
- **The grand-strategy information exists but has nowhere to show:** provinces, subjects, wars, the date, events and the
  economy are all in the game, but there's no province or nation window, no top bar, no tooltip that explains a number,
  and one map mode.

### 4.2 Principles

1. **The map is the game.** Bars sit on the edges; windows slide in from the left and close with Esc.
2. **Every number explains itself.** Hovering shows its breakdown, e.g. "Income +41 = provinces 28 + trade 9 + base 10 −
   non-core provinces 6". The engine returns breakdowns (§5.1); the interface only prints them.
3. **Pausable real time.** Space pauses and 1–4 set the speed; `LocalServer` already has pause and four speeds. Important
   events pause single-player.
4. **Select, then act.** Left click selects a province and its nation; right click opens the action wheel.
5. **A period look:** dark panels with brass edges or parchment, serif display type (Cinzel or EB Garamond, OFL, from
   Google Fonts), icons from game-icons.net (CC BY 3.0, 4,000+ SVGs) and flags in frames. One theme file in
   `src/client/overreach/`.
6. **Our code in our folder:** Lit components in `src/client/overreach/ui/`, fed by `GameView`, `ProvinceView` and a new
   `NationView` for the new state.

### 4.3 Layout

```
┌[flag] Gold 1,240 (+41) │ Troops 180k/320k │ Stability +1 │ Prestige 58 │ Infamy 12/25 │ Research 64% ── 14 Mar 1848 ▮▮▮▯ ⏸┐
│ [! Can form Germany] [✉ Peace offer from Denmark] [⚔ Coalition forming]                                                  │
│┌───────────────┐                                                                              ┌──────────────────────┐│
││ Province or   │                                                                              │ Outliner             ││
││ nation window │                         M A P                                                │  Wars (war score)    ││
││ (tabs)        │         curved country names, province and town names by zoom,               │  Attacks             ││
││               │         stripes on occupied provinces                                        │  Boats               ││
│└───────────────┘                                                                              │  Subjects and allies ││
│ [event log]                                                                                   └──────────────────────┘│
│                                                          [commitment 30% ━━━○────]  [map modes ▦ ▦ ▦ ▦ ▦ ▦ ▦ ▦]        │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.4 Screens

| Screen          | What it shows                                                                                                                                                                                                                                                                                                                                                       | Replaces                          | Phase                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------- |
| Title screen    | Overreach's name, the start dates (date, title, a short blurb), Continue and Load, Sandbox, Observe, Settings, and Credits with "© OpenFront and Contributors" and the Source link                                                                                                                                                                                  | OpenFront's home page, Solo modal | G2                                  |
| Nation picker   | The start date's map, live. Hovering a nation shows its flag, name, government, rank and difficulty; recommended nations in a list; click to pick                                                                                                                                                                                                                   | The "Your nation" dropdown        | G2                                  |
| Top bar         | As in the layout. Every number has a breakdown tooltip                                                                                                                                                                                                                                                                                                              | Control panel's gold and troops   | G2, then each system's              |
| Alerts row      | Pulsing icons: a formable is ready, an event waits, a coalition forms, a truce ends, a peace offer, bankruptcy, unrest                                                                                                                                                                                                                                              | New                               | G2                                  |
| Outliner        | Wars with their war score, attacks under way, boats, subjects and allies, waiting events                                                                                                                                                                                                                                                                            | Attacks display                   | G2                                  |
| Province window | Name, owner and occupier, cores and claims, culture, religion, population and growth, trade good, terrain, structures inside, unrest, past owners. Actions: build here, release it as a nation                                                                                                                                                                      | New                               | G2, filled by G3–G6                 |
| Nation window   | Tabs: Overview (flag, government, ruler, capital, rank, prestige), Economy (income breakdown, goods, budget), Military (troops, commitment, mobilisation, tech bonuses), Diplomacy (every nation's relation and treaties; declare war with a casus belli, offer peace, ally, guarantee, vassalise, release, embargo), Subjects, Technology, Decisions and formables | Player panel                      | G2, filled by G3–G7                 |
| War screens     | Declare war (casus belli, war goal, who joins each side); the war (war score and its breakdown); the peace deal (demands with their war-score cost, and whether the other side accepts)                                                                                                                                                                             | New                               | G3                                  |
| Event window    | Title, a period illustration, the text, and options whose effects show on hover. Pauses single-player                                                                                                                                                                                                                                                               | Story panel's card                | G2 (look), G7 (content)             |
| Ledger (L)      | Rankings (great powers, land, population, income, troops) and graphs over time, drawn from yearly samples                                                                                                                                                                                                                                                           | OpenFront's leaderboard           | G9                                  |
| Map modes       | Political, terrain (relief only), provinces, diplomatic (relative to the selection: allies, subjects, enemies, truces), population, culture, religion, trade goods, income, unrest, cores and claims, wars (occupation), great powers and spheres, technology. Buttons bottom right, plus hotkeys                                                                   | Space's alternate view            | G2 (first five), then each system's |
| Country names   | EU4-style names drawn along a curve through each nation, sized to it; province names at middle zoom; town names close in (already built). OpenFront's name boxes with troop counts become a setting                                                                                                                                                                 | OpenFront's name boxes            | G2                                  |
| Event log       | Bottom left, with filters                                                                                                                                                                                                                                                                                                                                           | Events display, restyled          | G2                                  |
| Ending screen   | The ending, the final ledger, a timelapse of the 200 years                                                                                                                                                                                                                                                                                                          | Win modal                         | G9                                  |

Gone from the game screen: the leaderboard, team stats, chat and emoji (until multiplayer), the spawn and immunity timers,
the in-game promo, and OpenFront's right sidebar, whose buttons move to the Esc menu.

### 4.5 How map modes and country names get built

- **Map modes:** `ProvincePass` already has every tile's province on the GPU. A mode is a province → colour table (about
  5,400 entries) sent as a small texture, mixed over the territory colours. Changing mode rewrites that small texture,
  not the map. Occupation is a stripe pattern wherever a province's owner isn't the tile's owner.
- **Country names:** for each nation, take its largest piece of land, find the longest reasonably straight path inside it
  (Azgaar's Fantasy Map Generator, MIT, does this for its state labels by casting rays from the interior), fit a gentle
  curve, and draw the name along it with the renderer's text program. Recompute only nations whose borders moved, at most
  a few a second.

---

## 5. The grand-strategy systems

### 5.1 One mechanism under all of them: modifiers

- **Each nation has a list of modifiers,** each with a source, a target and a value in per-mille (integers, for
  determinism). The targets are gold income, troop cap, troop growth, attack strength, defence, infamy gain, unrest,
  research and build cost.
- **Upstream reads them through one hook per target,** the way `Config.eraLocked` works: `maxTroops`,
  `troopIncreaseRate`, gold income, `attackLogic` and unit costs. That's about six one-line hooks in `Config.ts` for every
  system in this plan.
- **The list is also the tooltip's breakdown** (principle 2 in §4.2).
- **Systems run on the calendar's monthly and yearly pulses** (a month is 50 ticks), not every tick.

### 5.2 What a grand strategy game has that Overreach doesn't

| System                       | From                        | Now                                       | Target                                                                                                                                                                            | Phase            |
| ---------------------------- | --------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Declaring war                | EU4, Victoria               | Any attack is a war                       | Declare with a casus belli: claim, core, conquest, liberation, colonial, independence or an event's. Without one, it costs stability and infamy                                   | G3               |
| Occupation                   | EU4                         | Taking a province owns it                 | Provinces taken in war are occupied; they change owner only by treaty                                                                                                             | G3               |
| War score and peace deals    | EU4                         | A war ends after 3 years without fighting | War score from occupation, losses and the war goal. Peace deals: provinces, vassalage, releasing nations, reparations, humiliation, white peace. Five-year truces                 | G3               |
| War exhaustion               | EU4                         | None                                      | Rises with losses and occupation, raises unrest, and pushes the AI to peace                                                                                                       | G3               |
| Calls to arms                | EU4                         | The AI's "assist" behaviour               | Allies and subjects are called in; refusing costs trust                                                                                                                           | G3               |
| Infamy                       | EU4 (AE), Victoria          | "Aggression" counted in tiles             | Infamy for each province taken by treaty, by its value. Coalitions (built) form from it                                                                                           | G4               |
| Government                   | EU4, Victoria, HoI          | None                                      | Absolute monarchy, constitutional monarchy, republic, theocracy, tribal, chartered company; later dictatorship, communist state, junta. Each is a set of modifiers                | G4               |
| Stability and unrest         | EU4                         | None                                      | Stability from −3 to +3; unrest per province from being non-core, culture and war exhaustion. Revolts (built) fire from unrest                                                    | G4               |
| Prestige and great powers    | Victoria                    | None                                      | Prestige from wins, treaties and events. The top 8 by prestige, industry and military are great powers, with a ranking                                                            | G4               |
| Ideologies and revolutions   | Victoria, HoI               | None                                      | A ruling ideology. Ideological revolts become civil wars that change the government (1848, 1917, 1936)                                                                            | G4, G7           |
| Budget                       | EU4, Victoria               | Gold only                                 | A tax level (income against unrest), loans, bankruptcy                                                                                                                            | G4               |
| Technology                   | Victoria                    | Eras by date                              | Research in five fields (army, navy, commerce, industry, culture). A tech gets cheaper once its historical year passes or neighbours have it. It unlocks structures and modifiers | G5               |
| Era units                    | ROADMAP M11                 | An 1836 army fights like a 1950 one       | Army tech scales attack and defence                                                                                                                                               | G5               |
| Terrain and rivers           | EU4                         | Elevation only                            | Forest, jungle, marsh, desert, mountains and river crossings slow attackers and add defence                                                                                       | G5               |
| Mobilisation                 | Victoria, HoI               | None                                      | Raise the troop cap for a steady gold cost                                                                                                                                        | G5               |
| Navy                         | EU4, Victoria               | Warships, transports, trade ships         | Blockades cut port income; canals open on their dates                                                                                                                             | G5               |
| Trade goods                  | EU4, Victoria               | None                                      | A good per province, priced by era (coal from the railways, rubber from 1890, oil from 1900); a goods map mode; the monopoly ending counts them                                   | G6               |
| Culture and religion         | EU4, Victoria               | Homeland layer only                       | Culture and religion per province; accepted cultures. Provinces of other cultures pay less and revolt more                                                                        | G6               |
| Nationalism                  | ROADMAP M11                 | Revolts of non-core provinces             | Separatism wherever homeland and owner differ. This is how the 1836 map drifts toward today's without scripting: Belgium's way, the Balkans, then decolonisation                  | G6               |
| Colonisation                 | Victoria                    | OpenFront's expansion into unowned land   | Range from ports, a cost, natives (tribes exist), dominions, the Berlin Conference                                                                                                | G6               |
| Modernisation                | Victoria                    | None                                      | Meiji, Tanzimat and Self-Strengthening as reforms that speed up research                                                                                                          | G6               |
| Spheres of influence         | Victoria                    | Subjects only                             | Great powers compete for influence over smaller states; sphere members join their protector's wars                                                                                | G6               |
| Events and decisions         | EU4, Victoria               | 8 events, 4 formables                     | About 60 events, 25 formables and reforms, and goals for each great power                                                                                                         | G7               |
| Rulers                       | EU4, Cliopatria             | None                                      | Heads of state by date for the first decades (a name), generated after                                                                                                            | G7               |
| Historical starting strength | Victoria                    | Troops are half the cap                   | 1836 troops, population and industry per nation from Correlates of War data                                                                                                       | G7               |
| Start dates                  | EU4, AoH3, Ages of Conflict | 1836 only                                 | 1861, 1871, 1885, 1914, 1936, 1962                                                                                                                                                | G8               |
| Save and load                | Every one                   | Scenario save (territory only)            | A full save from the core's `snapshotGame()`, and a yearly autosave                                                                                                               | G2               |
| Ledger, history, timelapse   | EU4, Ages of Conflict       | None                                      | Graphs, a history log, and 200 years replayed at speed (OpenFront records replays)                                                                                                | G9               |
| Sandbox tools                | AoH3, Ages of Conflict      | Paint, nations, provinces, subjects       | Plus editing each new system's state (government, tech, cores)                                                                                                                    | With each system |

**Left out on purpose:** individual armies, generals and supply; Victoria's population types and market simulation;
monarch points, estates and dynasties; a scripting language (events stay TypeScript, as ROADMAP M13 says).

### 5.3 War and peace (the biggest change)

This is the change that most makes Overreach a grand strategy game, and it also fixes the handoff's 218 open wars.

- **A war is an object:** two sides, a war goal, a war score and a start date. `Diplomacy.ts` already keeps wars; they
  gain these fields.
- **Conquest stays OpenFront's,** tile by tile through `conquer()`. What changes is the province layer: a province that
  flips during a war keeps its **owner** and records its **occupier**. Income, cores and the province's colour follow the
  owner; stripes show the occupier. Upstream's attack code isn't touched.
- **War score** runs from −100 to +100: occupied provinces weighted by population, the war goal held, troop losses, and a
  slow gain for whoever holds the goal.
- **Peace:** the side ahead offers terms, each costing war score (a province costs its share of the loser's value). The
  AI accepts what its war score covers, and asks for peace when war exhaustion or the score says so. At peace, ceded
  provinces change owner, and the rest go back to their owners through `conquer()`.
- **Unowned land and tribes need no war:** expanding into them is colonisation and owns at once, as today.
- **The AI** declares only with a casus belli and the stronger side, joins through calls to arms, and seeks peace.
  `WAR_CHANCE` and `PEACE_TICKS` go. Protecting its own subjects (handoff item 5) comes with this.
- **Done when,** in a 10-year World 1836 run: at most about 20 wars are open at once, every war ends in a treaty or a
  white peace, about 139 nations are alive (F7's target), and a human can gain a province only by treaty. A 10,000-turn
  fuzz, like F4's, keeps the owner and occupier rule.

---

## 6. History content

| Content                                                                                                 | Source                                                                                                                                                                | Licence                                  | Use                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Borders for each start date                                                                             | `aourednik/historical-basemaps`: world_1815, 1880, 1900, 1914, 1920, 1938, 1945, 1960                                                                                 | GPL-3.0 (used already)                   | The base for each bookmark                                                                                                                               |
| Borders by exact year                                                                                   | Seshat's Cliopatria: 1,600+ polities from 3400 BCE to 2024, each with start and end years and Wikidata links (`github.com/Seshat-Global-History-Databank/cliopatria`) | CC BY 4.0                                | Moves each basemap to its exact year; ROADMAP §3.3's rules go on top                                                                                     |
| 1836 population                                                                                         | HYDE 3.3 (Utrecht University), 1830 and 1840 grids                                                                                                                    | Open; check the licence file on download | Province populations (§3.3)                                                                                                                              |
| GDP and population per country, 1820 and 1850                                                           | Maddison Project Database 2023                                                                                                                                        | CC BY 4.0                                | Calibrates gold                                                                                                                                          |
| Troops, industry and population per state (1816–2022); wars; territorial changes (1816–2018); alliances | Correlates of War: National Material Capabilities, Territorial Change, Inter-State War, Formal Alliances                                                              | Free with citation                       | Starting strength, the historical pressure behind events, each bookmark's alliances. Read at build time; the game ships derived numbers and the citation |
| Government by year, 1789–1920                                                                           | Historical V-Dem                                                                                                                                                      | Check before use                         | Starting governments. Not Polity5: it forbids redistribution                                                                                             |
| Town names over time, founding dates, heads of state                                                    | Wikidata                                                                                                                                                              | CC0                                      | Names by date (§3.3), rulers (G7)                                                                                                                        |
| Flags by date                                                                                           | Wikimedia Commons                                                                                                                                                     | Mostly public domain; check each         | Flags that change with the date and with events                                                                                                          |
| Event pictures                                                                                          | Period paintings and engravings on Wikimedia Commons                                                                                                                  | Public domain                            | The event window                                                                                                                                         |
| Music                                                                                                   | Public-domain recordings of the period's composers (Musopen): Chopin, Strauss, Verdi, Dvořák, Tchaikovsky                                                             | Public domain                            | The soundtrack                                                                                                                                           |

**Events to write by G7 (about 60), on top of the eight built:** Hanover's union ends (1837), Oregon (1846), all of 1848,
the Indian Rebellion and the Company's end (1857), Italy's wars (1859–70), the American Civil War (1861), Prussia's wars
(1864–71), the Berlin Conference (1884), the Boxers (1900), Russia and Japan (1904), the Balkan Wars (1912), the crisis of
1914, the revolutions of 1917, the Depression (1929), the next great war, decolonisation, the Cold War.

**Formables and renames (about 25, on top of Germany, Italy, Romania and Yugoslavia):** Canada, Australia, South Africa,
Poland restored, Hungary, Czechoslovakia, Greater Colombia, Central America, Arabia, India, Pakistan, Indonesia, and
renames by event: Prussia → German Empire, Qing → Republic of China, Russia → Soviet Union, Ottoman Empire → Turkey.

## 7. Code and designs to reuse

| Project                                           | Licence                  | What we take                                                                                                                                |
| ------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Azgaar's Fantasy Map Generator                    | MIT                      | Curved state-label placement; ideas for map modes, cultures and religions                                                                   |
| OpenVic (Victoria 2 remade in Godot and C++)      | GPL-3.0                  | Victoria's formulas for prestige, great powers, crises and influence, for the same 1836 start. GPL-3.0 code may be ported into an AGPL game |
| Unciv                                             | MPL-2.0                  | The JSON shape of a tech tree and policies                                                                                                  |
| Freeciv (civ2civ3 rules)                          | GPL-2.0+                 | A tested set of governments and their effects                                                                                               |
| uPlot                                             | MIT                      | Ledger graphs (about 50 KB)                                                                                                                 |
| game-icons.net                                    | CC BY 3.0                | Interface icons                                                                                                                             |
| Natural Earth vectors and Natural Earth II relief | Public domain            | Coasts, lakes, rivers and the painted relief                                                                                                |
| ETOPO 2022, RESOLVE Ecoregions 2017               | Public domain, CC BY 4.0 | Elevation, terrain types                                                                                                                    |

**Not usable:** OpenDoctrines (a non-commercial licence), Polity5 (no redistribution), and Paradox's or Age of History's
files and art (copyrighted). Every new source gets a line in `CREDITS.md`.

---

## 8. Phases

Each phase ends with a playable game and follows `CLAUDE.md`: tests for every core change, text in `en.json`, lint, and
one commit per slice.

### G0: The engine fork (1 session)

- Merge `upstream/main` once before deleting anything; there has been no merge since the fork.
- Delete OpenFront's shell and commerce code (decision 1). Keep the other maps until Earth is signed off (G1).
- Add `scripts/overreach/merge-upstream.sh`: merge, then `git rm` each modify/delete conflict on a file we deleted.
- Rewrite `CLAUDE.md`'s Overreach section for the new rule.
- **Done when:** lint, the production build and the Overreach tests pass, and World 1836 plays.

### G1: The Earth map (3–4 sessions)

1. **Speed test:** build Earth at 5,120, 5,632 and 6,144 wide, place a 250-nation scenario, and measure tick time
   (`ScenarioPerf`), load time, memory and frame rate in Chrome. Take the biggest that holds a mean tick under 15 ms, a
   p99 under 50 ms and 30 fps on this machine.
2. `build_earth.py`, the relief layer, and the terrain-type and river layers (data only).
3. `build_1836.py` for any map bounds; provinces cut by every start date's borders; HYDE population; historical names and
   founding dates.
4. World 1836 moves to Earth. Then delete OpenFront's other maps; the static site drops to ~50 MB.

- **Done when:** the 136 town checks pass on Earth, Hamburg, Frankfurt and Luxembourg are visible, and you sign off
  Europe, the Americas, India and Africa on screen. This replaces F3's pending sign-off.

### G2: The grand-strategy shell (3–4 sessions)

- Title screen with the start dates, nation picking on the map, top bar, alerts, outliner, province and nation windows
  (with the data we have), the event window, the event log, hotkeys, the theme, and left-click-selects.
- Map modes: the framework plus political, terrain, provinces, diplomatic and population. Curved country names.
- **Save and load:** a save is a core snapshot. Loading starts a new game whose first tick restores it, the way
  `ScenarioExecution` places a scenario, so the worker is never rebuilt mid-game. A yearly autosave goes to IndexedDB.
- **Done when:** you can start 1836 as Prussia by clicking it, read any province and nation, switch map modes, save in
  1840 and load it, and never see an OpenFront menu.

G1 and G2 don't depend on each other and can go in either order.

### G3: War and peace (3 sessions)

As §5.3, including the declare-war, war and peace-deal screens.

### G4: The state (2–3 sessions)

- Modifiers (§5.1) with tooltips everywhere, government types, stability and unrest, prestige and the great-power
  ranking, infamy in place of tile aggression, budget and loans, ideological revolts and civil wars.
- **Done when:** every number in the top bar is real and explains itself, and the 1836 ranking has Britain, France,
  Russia, Austria and Prussia among its great powers.

### G5: Military and technology (2–3 sessions)

- The tech tree (five fields, 1836–2036), era units as modifiers, terrain and rivers, mobilisation, blockades, and canals
  by date. `eraLocked`'s date locks become tech unlocks.
- **Done when:** a 1950 army beats an 1836 army three times its size, and Suez opens in 1869.

### G6: Economy, culture and the world order (2–3 sessions)

- Trade goods, culture and religion, nationalism, colonial range and the Berlin Conference, modernisation, spheres of
  influence.
- **Done when:** an 80-year AI run has claimed most of Africa by about 1900 (ROADMAP M5), and nationalism frees some
  Balkan or Latin American states without a script.

### G7: History content (3 sessions, then ongoing)

Starting strength from Correlates of War, rulers, flags by date, the events and formables in §6, and goals for each great
power (the AI's historical interests: Russia and the Straits, Prussia and Germany, Britain and the balance of power).

### G8: More start dates (2–3 sessions)

1861, 1871, 1885, 1914, 1936 and 1962 from §6's sources. The provinces were already cut for them in G1.

### G9: Ledger, history and endings (2 sessions)

The ledger with graphs, a history log, the timelapse replay, and the ending screen.

### G10: Release (2 sessions)

Music and sounds, a tutorial, deploying the static site, making the repo public with the Source link (AGPL), and then
multiplayer on upstream's server.

**In all, about 25–30 sessions.** G1 and G2 alone change how the game looks and feels.

## 9. Where the handoff's next work went

| Handoff item                                             | Goes to                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| 1. Too many wars                                         | G3. Tuning `WAR_CHANCE` now would be thrown away           |
| 2. Era units                                             | G5                                                         |
| 3. Government, stability, trade goods, events, formables | G4, G6, G7                                                 |
| 4. Population per country, historical town names         | G1 (HYDE, Wikidata)                                        |
| 5. The AI betraying subjects; humans demanding vassalage | G3 (peace deals, calls to arms) and G2 (the Diplomacy tab) |
| 6. Multiplayer                                           | G10                                                        |

## 10. Risks

- **Speed and memory at ~6× the tiles.** The G1 speed test comes before anything is built on the new map, with 5,120
  wide as the fallback.
- **Occupation changes how every war ends.** It lives in our province layer (owner and occupier), so upstream's attack
  code stays untouched, and a fuzz test guards it.
- **AI quality.** Grand-strategy AIs fail at when to declare and what to demand. Keep those decisions as simple scores,
  and measure them with long headless runs (F7's method) against saved baselines.
- **Scope.** 25–30 sessions, but each phase ships a playable game.
- **Upstream drift after G0.** Fewer client merges will be clean; decision 1 accepts that.
- **Licences.** historical-basemaps makes the scenarios GPL, which is fine for an AGPL game. CC BY sources need credit.
  Correlates of War and V-Dem are build-time inputs.
