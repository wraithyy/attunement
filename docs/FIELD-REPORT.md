# Field report — integrace attunement 0.4.4 do reálné appky

Záznam z jedné ostré integrace: co se pokazilo, v jaké fázi, jak se to
projevilo a co by to spravilo. Řazeno chronologicky podle toho, jak problémy
nastaly.

**Kontext:** SPA, React 19 + Vite 6 + TanStack Router/Query + MUI, 15 config
klíčů, 17 konzumentů configu. Nahrazoval se ruční `fetch("/app-config.json")`
+ zod parse. Integroval jsem to jako někdo, kdo knihovnu nezná a čte README.

**Legenda:** 🔇 = tichá chyba, nic ji nenahlásí.

> **Stav (2026-07-31):** všechny nálezy adresovány. P5–P8, P14–P16 v 0.4.x
> (patch batch); P1, P2, P9 v README; P3 (`onReady`), P10 (`bindReact`),
> P11 (`retry` + default fallback), P12/P13 (testing docs) v API vlně (0.5.0)
> — viz CHANGELOG a `plans/api-wave.md`.

---

## Fáze 1 — první integrace podle README

### P1 — `.then()` gating renderu, závod místo Suspense 🔇

**Kdy:** hned. Původní kód vypadal takhle:

```tsx
getEnvRuntime().then((config) => { /* wiring */ root.render(<App />) });
```

Nejmenší diff bylo prohodit `getEnvRuntime()` za `appConfig.load()` a nechat
zbytek. Tak jsem to udělal.

**Symptom:** žádný. Build zelený, lint zelený, appka fungovala. `Provider`
tam byl, ale neměl co gateovat — do stromu se dostal až po resolve. `fallback`
i `errorFallback` byly mrtvý kód. Commitnul jsem to a pushnul.

Odhalilo se to až tím, že si toho všiml člověk. Automaticky nic.

**Příčina:** README ukazuje cílový stav (`createRoot().render(<Provider>)`),
ale neukazuje, jak vypadá **migrace** z ručního async bootstrapu. Kdo migruje,
přirozeně zachová `.then()` a Suspense gate zahodí, aniž by to poznal.

**Hint:** sekce „Migrating from a hand-rolled loader" s před/po. Případně DEV
warning, když se `Provider` mountne až po tom, co je promise resolved — to je
detekovatelné a je to spolehlivý příznak, že si někdo gateuje render sám.

---

### P2 — záruka pořadí `onLoad` není z dokumentace vidět 🔇

**Kdy:** při opravě P1. Potřeboval jsem nastavit `router.update({ basepath })`
před prvním renderem. Napsal jsem:

```ts
appConfig.load().then((c) => router.update({ basepath: c.BASE_PATH }));
```

**Symptom:** funguje. Ale jen náhodou — `.then()` se registruje při module
evalu, tedy dřív, než React nasadí svoje suspense resumption. Je to závod,
který vyhrávám shodou okolností v pořadí importů.

Že `onLoad` je **jiná kategorie záruky**, jsem zjistil až čtením zdrojáku:

```ts
// index.ts:149 — uvnitř promise, před resolve
await options.onLoad?.(config);
```

**Příčina:** README prezentuje `onLoad` jako pohodlí pro setup („wire up API
base URL, logger"). Nikde neříká, že je to **jediný** hook se zárukou, že
doběhne před prvním renderem, a že `.then()` tuhle záruku nemá.

**Hint:** jedna věta v README + kontrastní příklad. Tohle je chyba, kterou
udělá každý junior a každý LLM — vypadá ekvivalentně a chová se ekvivalentně,
dokud se nezmění pořadí importů.

---

## Fáze 2 — přesun wiringu do `onLoad`

### P3 — cyklus modulů, TDZ crash na dosah

**Kdy:** hned jak jsem P2 opravil správně, tedy přesunul `basepath` do
`onLoad`. Potřeboval jsem v `config.ts` referenci na router:

```
config.ts (onLoad chce router)  →  router.tsx (čte useConfig)  →  config.ts
```

**Symptom:** statický import = cyklus. A protože můj shim dělal

```ts
export const ConfigProvider = appConfig.Provider;  // module-scope čtení
```

nespadlo by to na hezkou chybu, ale na `TypeError: Cannot read properties of
undefined (reading 'Provider')` — tedy TDZ, kde `appConfig` ještě není
přiřazený.

**Obešel jsem to** dynamickým importem uvnitř `onLoad`:

```ts
const { router } = await import("../router");
```

Funguje, ale je to workaround, který si musí každý vymyslet sám.

**Příčina — a tohle je podle mě nejdůležitější nález celého reportu:**

`onLoad` je jediný race-free hook a zároveň žije v modulu, na kterém visí celý
React strom (protože `attuneReact()` vrací `Provider` i `use`). Takže cokoliv,
co chceš z `onLoad` nakonfigurovat a co zároveň čte config, je cyklus. Router,
i18n, feature-flag klient, analytics wrapper — to všechno jsou typicky moduly,
které dělají obojí.

Není to okrajový případ, je to důsledek toho, že jedna továrna vrací loader
i React binding.

**Hint — registrační API, otočí směr závislosti:**

```ts
// router.tsx — router zná config, config nezná router. Žádný cyklus.
appConfig.onReady((config) => router.update({ basepath: config.BASE_PATH }));
```

Callbacky se přidají do stejného awaitovaného řetězu jako `onLoad`. Registrace
z module scope je vždy bezpečná, protože fetch je async. Pro registraci po
resolve definovat sémantiku (spustit hned + `console.warn` v DEV).

`onLoad` pak zůstane pro věci, které config modul vlastní (axios baseURL),
`onReady` pro všechno ostatní.

---

### P4 — `router.update()` vyžaduje celý context

**Kdy:** ve stejném kroku. Drobnost, ale stála čas:

```
error TS2345: Property 'context' is missing in type '{ basepath: string; }'
```

Není to chyba attunementu — je to TanStack Router. Ale je to přesně ten typ
tření, na který narazí každý, kdo `onLoad` použije k překonfigurování už
vytvořeného singletonu. Řešení `context: router.options.context`.

**Hint:** kdyby v recipes byl konkrétní TanStack Router příklad (je to
nejčastější router v tomhle ekosystému), ušetří to lidem tenhle krok.

---

## Fáze 3 — ošetření chyb

### P5 — default `errorFallback` je bílá stránka 🔇

**Kdy:** když jsem psal `errorFallback` a šel se podívat, co se stane bez něj.

README tvrdí:

> Invalid config → `ConfigError` in your `errorFallback` **instead of a white
> page**

Ale `react.tsx:54`:

```ts
return typeof fallback === "function" ? fallback(error) : (fallback ?? null);
```

**Symptom:** `errorFallback` nepředán → `null` → přesně ta bílá stránka, proti
které se knihovna vymezuje. Slib platí jen když si vzpomeneš. Do konzole se to
dostane (React loguje chyby z boundary), vizuálně nic.

**Hint:** default fallback = minimální neostylovaný blok „Configuration failed
to load", v DEV navíc `error.message`. Dvacet řádků, maže celou třídu
problémů.

---

### P6 — `ConfigError.message` leakuje strukturu configu

**Kdy:** hned poté. První verze mého fallbacku vypisovala `error.message`
přímo. Pak mi došlo, že `formatIssues` (`index.ts:75`) skládá zprávu z názvů
klíčů a `resolveSources` (`index.ts:128`) z URL zdrojů. To koncovému
uživateli v produkci před oči nepatří.

Musel jsem si to gateovat sám:

```tsx
{import.meta.env.DEV && <pre>{error.message}</pre>}
```

**Hint:** kdyby default fallback z P5 existoval, měl by tohle rozlišení
zabudované. Případně `ConfigError` může mít vedle `message` i `publicMessage`,
aby si to člověk nemusel hlídat.

---

## Fáze 4 — devtools

### P7 — kolize s TanStack Query devtools

**Kdy:** při ověřování v prohlížeči. Playwright na tlačítko nedokázal
kliknout:

```
TimeoutError: element is visible, enabled and stable
  <circle r="316.5" ...> from <div class="tsqd-parent-container">
  subtree intercepts pointer events
```

**Symptom:** attunement panel je `position: fixed; bottom: 16px; right: 16px`
(`devtools.tsx:267`). TanStack Query devtools sedí na stejném místě a žerou
pointer events. Musel jsem tlačítko odkliknout programově přes `.click()`.

**Příčina:** vpravo dole je v React ekosystému nejvytíženější místo na
stránce — Query devtools, Router devtools, react-scan. A README sám nabízí
TanStack Devtools plugin, takže ta kombinace je očekávaná, ne exotická.

**Hint:** `position?: "bottom-left" | "bottom-right" | "top-left" |
"top-right"` prop, default `bottom-left`. Vlevo je volno.

---

### P8 — devtools neprokouknou `z.preprocess`, tedy vlastní recept knihovny 🔇

**Kdy:** při kontrole panelu. Všech 15 polí se vyrenderovalo jako text input —
včetně dvou booleanů, které měly být checkboxy.

Čísla jako text jsou záměr (`devtools.tsx:148`, aby „1." přežilo psaní).
Booleany ne. Ověřil jsem si to na zod 3.24.1:

```
ENABLE_RECAPTCHA (preprocess) -> ZodDefault > ZodOptional > ZodEffects > STOP
                                 keys = schema, effect, typeName
MAX_VEHICLE_PHOTOS (coerce)   -> ZodDefault > ZodOptional > ZodNumber   ✓
```

**Příčina:** `unwrap()` (`cli.ts:92`) jde po `_def.innerType`. Zod 3
`z.preprocess()` vyrábí `ZodEffects`, který má `_def.schema`. Unwrap se
zastaví, typ spadne na `"unknown"`, vyrenderuje se text input.

**Proč to bolí víc, než vypadá:** `z.preprocess` pro string→boolean je
**dokumentovaný recept této knihovny** — recipes, sekce *All-strings config
(env-var substitution)*, pro envsubst pipeline. Kdo se řídí docs, rozbije si
panel. Recept a devtools si přímo odporují.

**Hint:** ve `unwrap` následovat i `_def.schema` (zod 3 ZodEffects) a `_def.in`
(zod 4 pipe). Pár řádků.

---

### P9 — devtools se defaultně vezou do produkčního bundlu 🔇

**Kdy:** při psaní integrace podle README.

```tsx
import { AttunementDevtools } from "attunement/devtools";
{import.meta.env.DEV && <AttunementDevtools config={appConfig} />}
```

`import.meta.env.DEV` odstraní **volání**, ne **import**. Panel (298 řádků +
celý `introspectShape`) zůstane v prod bundlu. Že se to má řešit dynamickým
importem, je zmíněné v jedné závorce na konci sekce Devtools — kdo čte
příklad a ne prózu okolo, mine to.

**Hint:** ukázat rovnou `lazy(() => import(...))` jako výchozí vzor. Vedlejší
efekt: dnes to bije s claimem „~1 kB, tree-shakable".

---

## Fáze 5 — CI

### P10 — quick start znemožňuje `attunement check`

**Kdy:** když jsem chtěl doplnit CLI kontrolu do GitLab CI.

Quick start dává schéma do `config.ts` vedle `attuneReact()`. Recept pro CI
naopak vyžaduje schéma v samostatném modulu, „so the CLI can import it without
pulling in the app".

Můj `config.ts` má po přesunu wiringu do `onLoad` (P3) importy axiosu, GA
a MSW. Takže `attunement check --schema src/lib/config.ts` by se pokusil
natáhnout půl aplikace do Node procesu.

**Symptom:** buď refaktor, nebo žádná CI kontrola. Nechal jsem CI kontrolu
nedodělanou.

**Příčina:** stejný kořen jako P3 — jedna továrna vrací loader i React
binding, takže se z config modulu stává uzel, na kterém visí komponenty,
bootstrap, wiring i CLI.

**Hint:** doporučit v README tři soubory a dát k tomu API:

```ts
// config-schema.ts  — leaf, importovatelný z CLI i testů
// config.ts         — attune(schema) + onLoad
// config.react.ts   — bindReact(appConfig)
```

Tzn. přidat `bindReact(attuned)` / overload `attuneReact(attuned)`. Cyklus
z P3 to samo nevyřeší (na to je `onReady`), ale vyřeší to CLI a udělá to
hranice čitelné.

---

## Nalezeno čtením kódu, nezažito v provozu

Tyhle jsem na vlastní kůži nepotkal — vypadly ze čtení zdrojáku při psaní
tohoto reportu. Uvádím je odděleně, protože nemám provozní důkaz.

### P11 — není cesta zpět z chyby

`load: () => promise` vrací jednu cachovanou promise. Když rejectne, je to
navždy: není `reload()`, `reset()`, error boundary nemá reset path.

S defaulty `fromJson` (8 s timeout × 3 pokusy + backoff) to dává scénář:
uživatel na flaky síti chytne ~25 s `fallback` a pak trvale mrtvou appku,
kterou oživí jen manuální reload stránky.

Pro knihovnu, jejíž teze je „config je infrastruktura, ne build artefakt", je
to slabé místo — infrastruktura občas blikne.

**Hint:** `appConfig.reload()` (zahodí cache, nová promise) a
`errorFallback: (error, retry) => ...`. Minimální varianta: default fallback
z P5 dostane tlačítko, které dělá `location.reload()`.

### P12 — `createTestProvider` neškáluje se schématem

Validuje **jen** `overrides` proti celému schématu (`testing.tsx:19`). Každé
povinné pole bez defaultu tedy musí být v **každém** testu.

README příklad to skryje, protože tam je povinné jediné pole (`API_URL`). Moje
schéma jich má sedm → sedm klíčů v každém volání, copy-paste napříč suitou,
a rozbití všech testů při přidání povinného klíče.

**Hint:** `createTestProvider(config, overrides, { base })` nebo
factory-of-factory s baseline fixture.

### P13 — async schéma: runtime ano, testy ne

`attune()` awaituje `validate()`, takže async refinement za běhu projde.
`createTestProvider` na něj hodí `throw` (`testing.tsx:20`). Asymetrie není
nikde zmíněná — projde v dev, rozbije se až v testech.

### P14 — `fromWindow` v quick startu nikdy nevystřelí 🔇

Quick start má `sources: [fromWindow("__APP_CONFIG__"), fromJson(...)]`,
sekce Vite plugin má `attunement({ configFile })` bez `injectKey`. Jenže
`injectKey` defaultuje na `false` (`vite.ts:32`).

Kdo zkopíruje obojí, má zdroj, který **vždy** vrátí `undefined` a tiše
propadne dál — plus ten extra request, kterému měl `fromWindow` zabránit.

**Hint:** dát `injectKey: "__APP_CONFIG__"` do Vite snippetu, nebo `fromWindow`
z quick startu vyhodit. V DEV by mohl jednou `console.debug`nout „key not
present, falling through".

### P15 — `--diff` tiše neudělá nic při jednom souboru 🔇

`bin.ts:119`: `if (values.diff && loaded.length > 1)`. Glob matchne jeden
soubor (rozbitá CI matrix, lokální zkouška) → projde zeleně, nikdo se
nedozví, že se diff nespustil. Pro CI kontrolu je tiché no-op nejhorší
varianta.

### P16 — „any Standard Schema" vs. Zod-only tooling

Standard Schema je headline feature. Ale `introspectShape` (`cli.ts:142`)
vyžaduje `.shape`, tedy Zod object — na tom stojí devtools panel i
`attunement docs`. Uživatel Valibotu dostane validaci a nulové tooling, a
dozví se to až o tři sekce níž.

Není to chyba implementace (Standard Schema introspekci nemá), je to chyba
umístění caveatu — patří k tomu bulletu, ne do sekce Devtools.

---

## Shrnutí

Společný jmenovatel většiny nálezů: **knihovna má výborné chybové hlášky pro
nevalidní config a skoro žádné pro nesprávné použití API.**

Osm z šestnácti problémů je označených 🔇 — nezahlásí je nic. Build projde,
lint projde, appka jede. P1 jsem takhle commitnul a pushnul.

| Fáze | Co udělám | Co se stane | Signál |
|---|---|---|---|
| migrace | nechám `.then()` gating | Suspense gate mrtvý | žádný |
| wiring | `.then()` místo `onLoad` | závod, vyhrává 99× ze 100 | žádný |
| chyby | vynechám `errorFallback` | bílá stránka | jen konzole |
| devtools | statický import | dev panel v prod bundlu | žádný |
| schéma | `z.preprocess` dle receptu | rozbitý panel | žádný |
| sources | quick start + Vite plugin | `fromWindow` nikdy nevystřelí | žádný |

### Priority

**Mění API, patří před 1.0:**

1. `onReady()` registrační API — jediné čisté řešení cyklu (P3)
2. `reload()` / retry cesta z chyby (P11)
3. `bindReact(attuned)` → tří-souborové rozvržení (P10)

**Levné, velký dopad:**

4. `unwrap` přes `_def.schema` — recept vs. devtools rozpor (P8)
5. Default `errorFallback` místo `null` (P5)
6. DEV warningy pro tichá selhání z tabulky výše
7. Devtools default `bottom-left` (P7)
8. README: záruka pořadí `onLoad` (P2), migrační sekce (P1), `injectKey`
   do Vite snippetu (P14), Zod-only caveat u Standard Schema bulletu (P16)

**Až bude čas:** `createTestProvider` baseline (P12), `--diff` warning (P15).
