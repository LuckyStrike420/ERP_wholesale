# Uitvoeringsplan: verbeteringen na de read-only UI-audit

**Opgesteld:** 11 november 2026 · **Status:** plan, er is niets geïmplementeerd, gemigreerd of gepubliceerd · **Repository:** `LuckyStrike420/ERP_wholesale`, branch `main` (commit `265e433`)

Dit document beoordeelt de drie auditbestanden (`admin-audit.md`, `backlog.md`, `inspectiechecklist.md`) tegen de werkelijke broncode, de migraties en de tests. Het bevat een verificatiematrix voor alle 40 OMS-items, een uitvoeringsplan in pakketten, de benodigde bedrijfsbesluiten en een voorstel voor het eerste pakket.

Gebruikte labels bij de status:

| Status | Betekenis |
|---|---|
| **Bevestigd** | De code (en waar mogelijk de live data) laat precies zien wat de audit beschrijft. |
| **Gedeeltelijk** | Klopt deels: er is een nuance, een deel bestaat al, of de oorzaak ligt anders dan de audit aannam. |
| **Niet bevestigd** | Klopt niet. (Komt in deze audit niet voor.) |
| **Al opgelost** | De functie bestaat al en werkt. (Komt in deze audit niet voor.) |
| **Nader onderzoek** | Alleen met een test of een besluit vast te stellen. |

Verwijzingen als `0002:229` betekenen: `supabase/migrations/0002_calculations.sql`, regel 229. `Master.tsx:115` betekent `web/src/pages/Master.tsx`, regel 115.

---

## 1. Korte beoordeling van de audit

### 1.1 Is dit de geaudite applicatie?

**Ja.** De audit is uitgevoerd op `luckystrike420.github.io/ERP_wholesale`, dat uit deze repository wordt gebouwd. Dit is gecontroleerd met alleen-lezen `SELECT`-opdrachten op de live Supabase-database (er is niets gewijzigd):

| Waarneming in de audit | Controle in code en live database |
|---|---|
| 12 modules, 9 rapporttabs, 5 admintabs | Komt overeen met `NAV` in `App.tsx`, `Reports.tsx`, `Admin.tsx`. |
| Auditlog: 84 regels | Live: 84 regels; **83 zonder gebruiker** (de eenmalige dataload), 1 door Sander. |
| Dashboardbadge 6, kop "Needs attention · 11" | Verklaard: de badge telt alleen *Action* en *Check* (`App.tsx:49`), de kop telt ook *Info* (`Dashboard.tsx:75`). Live: 11 signalen waarvan 5 *Info*. |
| 12 cashflowposten, allemaal zonder datum | Live: 12 van 12 zonder `due_date`. |
| 26122 "Shipped" zonder zending | Live: precies 1 order met status verscheept/geleverd zonder gekoppelde zending. |
| 0 betalingen, 0 koersen, 0 prijsafspraken | Live: bevestigd. |

### 1.2 Belangrijkste verschillen tussen audit en code

1. **Het systeem legt de gebruiker al vast, de interface toont hem niet.** `audit_log.changed_by` bestaat (`0003:33`) en wordt bij elke wijziging gevuld (`0003:45`; een test controleert dit, `scenarios.test.ts:286`). De audit concludeert terecht dat de actor niet zichtbaar is, maar de oplossing is een weergave, geen nieuwe logging (OMS-007).
2. **Het importlogboek ontbreekt live, en dat is mijn eigen leemte.** `import_runs` en `import_issues` hebben op Supabase 0 rijen, omdat de eerste data via een seed-bestand is geladen en niet via de importer. Daarom toont Admin → Import alleen de opdrachtregeltekst (`Admin.tsx`, tak `supabase`) en niet "Last saved import". De importopmerkingen (waaronder de PO 2710-melding) bestaan wel in de lokale rapportage, maar zijn niet in de live database terechtgekomen (OMS-011, OMS-033).
3. **De ontbrekende datums zijn bron-leemtes, geen importverlies.** In de Excel-werkmap zijn "Datum aanbetaling" en "Datum restbetaling" bij de inkooporders leeg, het blad PI overzicht heeft geen kolom "PI verstuurd op", en PO 2710 staat niet op het inkoopblad. De app mag deze datums dus niet afleiden (OMS-003, 011, 013).
4. **Twee van de audit-P1's zijn in werkelijkheid ontwerpkeuzes met een besluit erachter:** "alle rollen mogen alles lezen" staat letterlijk als besluit in `0003:68-69` (OMS-008), en de status "verscheept zonder aanbetaling" komt uit de werkmap zelf (de importer neemt statussen over, `importer.ts:340-345`; OMS-005).
5. **Drie bevindingen zijn ernstiger of anders dan de audit beschrijft:**
   - *Kostregelwijziging* (OMS-009): het productformulier **overschrijft** de bestaande kostregel (`Master.tsx:115`) in plaats van een nieuwe versie met ingangsdatum toe te voegen, terwijl de database versies wél ondersteunt (`0002:78-82`). Bevroren kosten ontstaan alleen bij een leveranciersfactuur en slaan afgeronde orders over (`0002:638-649`). Daardoor kan de marge van **afgeronde orders zonder leveranciersfactuur** achteraf verschuiven.
   - *Instellingen* (OMS-010): `app_settings.value` is ongevalideerde tekst (`0001:10-14`) en wordt in views naar getal omgezet (`0002:7-8`, `0002:48`). Een verkeerde waarde (bijvoorbeeld tekst) laat dan **alle schermen** falen.
   - *MOQ* (OMS-025/026): het veld MOQ wordt opgeslagen maar nergens gebruikt in de kostprijsberekening of in een signaal. Het is nu puur informatief.
6. **Twee schermen berekenen een percentage in de browser,** terwijl het ontwerpprincipe is dat de frontend geen geld berekent: marge% in `Dashboard.tsx` (KPI-tabel) en in `Reports.tsx` (tab Monthly). Het gaat om een deling van door de database geleverde bedragen, maar het geeft een tweede bron voor "marge%". Dit wordt meegenomen in pakket 1.
7. **Een hulpzin in de app belooft iets wat niet kan:** een gebruiker zonder rol krijgt "Ask the admin to add you under Admin → Users" (`App.tsx`), maar Admin → Users kan alleen een bestaand profiel bewerken en geen gebruiker toevoegen (OMS-039).

### 1.3 Wat de audit niet kon zien en de code wel laat zien (positief)

- De database dwingt al veel af: betalingen worden nooit verwijderd maar geannuleerd (`0002:652-668`), dubbele betalingen worden geblokkeerd (`payments_no_duplicates`), een betaling kan niet aan een andere klant, valuta of geannuleerde order worden toegewezen (`0002:670-698`), orders kunnen niet terug naar concept of worden heropend na annulering (`0002:575-584`), een order wordt alleen afgerond met factuur en zonder openstaand bedrag (`0002:587-594`), en het ordertype kan niet meer wijzigen zodra er een geldige betaling is (`0002:565-569`).
- 16 scenariotests plus importtests draaien op dezelfde migraties in een ingebedde Postgres (PGlite). Dit dekt een groot deel van de "checklist voor vervolg" al af (zie OMS-037).

### 1.4 Samenvatting van de 40 items

**Status na verificatie (40 items):** Bevestigd: 23 · Gedeeltelijk: 17. Geen item is geheel ‘niet bevestigd’ of ‘al opgelost’. ‘Uitbreiding’ en ‘ontwerp’ geven aan dat de waarneming klopt maar het geen fout is.

**Prioriteiten:** de audit telt P0 = 0, P1 = 11, P2 = 25, P3 = 4. Na onderbouwing stel ik voor: P0 = 0, P1 = 6, P2 = 25, P3 = 9. Elke afwijking staat bij het item toegelicht. Het sterkste argument voor verhoging is OMS-009 (bestaande afgeronde orders kunnen verschuiven); voor verlaging gelden OMS-003, 006, 008 en 011 (de app toont de leemte al of er is nu slechts één gebruiker).

**Belangrijk onderscheid** (zoals gevraagd): bij elk item staat of het een **softwarewijziging** is of het **herstellen van bestaande administratie**. Dat laatste (ontbrekende datums, kosten, koersen, PI-data, zendinggegevens) doet de software nooit zelf: de app maakt het zichtbaar en geeft een geautoriseerde invoerplek, maar vult nooit iets in op basis van een aanname.

---

## 2. Verificatiematrix

Kolommen: audit-prioriteit → voorgestelde prioriteit · type werk (**SW** = softwarewijziging, **ADM** = herstel van administratie door u, **BESLUIT** = eerst een bedrijfsbesluit) · pakket.

| OMS | Titel | Status | Prio audit → voorstel | Type | Pakket |
|---|---|---|---|---|---|
| OMS-001 | Ontbrekende kostprijs mag geen 100% marge opleveren | Bevestigd | P1 → P1 | SW | 1 |
| OMS-002 | Vul afboeking niet standaard met het volledige openstaande bedrag | Bevestigd (klantkant) | P1 → P2 | SW | 4 |
| OMS-003 | Twaalf ongedateerde cashflowposten | Bevestigd | P1 → P2 | SW | 1 |
| OMS-004 | Geen geruststellende achterstandsmelding zonder datumdekking | Gedeeltelijk | P1 → P1 | SW | 1 |
| OMS-005 | Vrijgavebeleid voor verzenden zonder aanbetaling | Bevestigd (toestand) | P1 → P1 | BESLUIT | 5 |
| OMS-006 | Signaleer Shipped zonder gekoppelde zending | Bevestigd | P1 → P2 | SW | 1 |
| OMS-007 | Auditregels herleidbaar tot gebruiker en record | Gedeeltelijk | P1 → P1 | SW | 3 |
| OMS-008 | Bevestig en toets leesrechten per rol | Bevestigd (ontwerp) | P1 → P2 | BESLUIT | 3 |
| OMS-009 | Historische marge-effecten van kostregelwijzigingen | Gedeeltelijk, ernstiger | P1 → P1 | SW | 2 |
| OMS-010 | Impactpreview bij instellingswijzigingen | Bevestigd + extra risico | P1 → P1 | SW | 2 |
| OMS-011 | Onvolledige geïmporteerde PO's laten beoordelen | Gedeeltelijk | P1 → P2 | ADM+SW | 9 |
| OMS-012 | Navigatiebadge en aandachtsteller begrijpelijk maken | Bevestigd | P2 → P2 | SW | 1 |
| OMS-013 | PI sent-status zonder verzenddatum | Gedeeltelijk | P2 → P2 | SW | 5 |
| OMS-014 | Documentcontrole per type in plaats van één vinkje | Bevestigd | P2 → P2 | SW | 8 |
| OMS-015 | Forwarders als selecteerbare relaties | Bevestigd | P2 → P3 | SW | 8 |
| OMS-016 | Ontbrekende ETD/ETA vullen en bewaken | Gedeeltelijk | P2 → P2 | ADM+SW | 8 |
| OMS-017 | Koppelingen aan orders en PO's zichtbaar en beheerbaar | Gedeeltelijk | P2 → P2 | SW | 8 |
| OMS-018 | Verkopen zonder batchtoewijzing | Gedeeltelijk (ontwerp) | P2 → P2 | BESLUIT | 7 |
| OMS-019 | Ontvangstdatum en ontvangen hoeveelheid onderscheiden | Bevestigd | P2 → P3 | SW | 6 |
| OMS-020 | Voorraadgrenzen en correctieredenen | Gedeeltelijk | P2 → P2 | SW | 7 |
| OMS-021 | Kwaliteitsindicatoren voor productstamdata | Bevestigd | P2 → P2 | SW | 10 |
| OMS-022 | Productdossier met varianten en handelsinformatie | Bevestigd (uitbreiding) | P2 → P3 | SW | 10 |
| OMS-023 | Read-only relatiekaarten | Bevestigd | P2 → P2 | SW | 10 |
| OMS-024 | Adressen en meerdere contacten | Bevestigd (uitbreiding) | P2 → P3 | SW | 10 |
| OMS-025 | Exacte prijsmatching en kostvoorrang uitlegbaar | Gedeeltelijk | P2 → P2 | SW | 2 |
| OMS-026 | Overlappende afspraken en geldigheid | Gedeeltelijk | P2 → P2 | SW | 2 |
| OMS-027 | Exportvaluta, percentages en statussen expliciet | Bevestigd | P2 → P2 | SW | 6 |
| OMS-028 | Iconknoppen benoemen, acties bereikbaar in brede tabellen | Bevestigd | P2 → P2 | SW | 6 |
| OMS-029 | Laden onderscheiden van een echt lege lijst | Bevestigd | P2 → P2 | SW | 1 |
| OMS-030 | Klanttegoed en allocatie als zichtbare workflow | Gedeeltelijk | P2 → P2 | SW | 4 |
| OMS-031 | Factuurverschil en verdeling vooraf zien | Gedeeltelijk | P2 → P2 | SW | 4 |
| OMS-032 | Ontbrekende rapportagekoersen met bron en dekking | Gedeeltelijk | P2 → P2 | ADM+SW | 4 |
| OMS-033 | Beheerbare importvoorbereiding in de UI | Bevestigd | P2 → P3 | SW | 9 |
| OMS-034 | Opgeslagen weergaven en tijdvakfilters | Bevestigd (uitbreiding) | P3 → P3 | SW | 11 |
| OMS-035 | Signalen opvolgbaar met eigenaar en deadline | Bevestigd (uitbreiding) | P2 → P3 | SW | 11 |
| OMS-036 | Klant en type wijzigen bij bestaande orderregels | Gedeeltelijk | P2 → P2 | SW | 5 |
| OMS-037 | Kritieke validatie en herstelpaden buiten productie verifiëren | Gedeeltelijk | P2 → P2 | SW | V |
| OMS-038 | Taal en terminologie consistent | Bevestigd | P3 → P3 | SW | 10 |
| OMS-039 | Gebruikerslevenscyclus vindbaar | Gedeeltelijk | P3 → P2 | SW | 3 |
| OMS-040 | Documentgeneratie en dossierarchief | Bevestigd (uitbreiding) | P3 → P3 | SW | 8 |


---

## 3. Per item

Elk item volgt dezelfde opbouw: *Auditbevinding* · *Onderbouwing* · *Impact en prioriteit* · *Oplossing* · *Afhankelijkheden en besluiten* · *Omvang en risico* · *Acceptatie en verificatie*.

### OMS-001 · Ontbrekende kostprijs mag geen 100% marge opleveren

**Status:** Bevestigd · **Prioriteit:** P1 → P1 · **Type:** SW · **Pakket:** 1

- **Auditbevinding:** concept Triventa toont kosten €0 en marge 100% (bevestigde UI-bevinding, E03).
- **Onderbouwing:** `v_order_lines` rekent een ontbrekende prijs als 0 (`coalesce(b.unit_cost, 0)`, `0002:127`), dus marge = omzet en `margin_pct` = 100%. `v_orders` telt die marge gewoon mee (`0002:200`). De fout wordt wel gesignaleerd: `v_attention` heeft de fout *cost_missing* (`0002:446-449`), maar lijst en detail tonen de 100% zonder markering. Het dashboard en de maandrapportage tellen concepten niet mee (`0002:411`), dus de huidige blootstelling is beperkt tot dit ene concept; een niet-concept regel zonder kostprijs zou wél in de totalen komen.
- **Impact en prioriteit:** P1 blijft: de vertekening is structureel en zou bij de eerste echte regel zonder kostregel de dashboardmarge opblazen.
- **Oplossing:** kolommen toevoegen (`cost_complete` per regel, `cost_missing_lines` en `margin_complete` per order); `margin_pct` is `NULL` zolang kosten ontbreken; de bekende bedragen blijven zichtbaar. UI toont "incompleet" in plaats van een percentage, met het aantal regels zonder kostprijs. Dashboardtotalen tonen een noot "N regels zonder kostprijs".
- **Afhankelijkheden en besluiten:** geen. Aanbeveling: incomplete marges wel in de totalen laten, maar altijd met noot. Herstel van de kostprijs zelf (kostregel voor Soepele Gewrichten) is **ADM**: ik vul geen kosten in.
- **Omvang en risico:** S. Risico: `create or replace view` mag alleen kolommen aan het einde toevoegen; bestaande kolommen houden hun betekenis, alleen de waarde van `margin_pct` wordt `NULL` bij onvolledige kosten. Alle verbruikers zijn gecontroleerd (Orders, OrderDetail, Reports, Dashboard).
- **Acceptatie en verificatie:** het bestaande concept toont geen 100%; lijst en detail gebruiken dezelfde status; een nieuwe scenariotest met een regel zonder kostregel; alle andere bedragen blijven identiek (vergelijking vóór en na op de importdataset).

### OMS-002 · Vul afboeking niet standaard met het volledige openstaande bedrag

**Status:** Bevestigd (klantkant) · **Prioriteit:** P1 → P2 · **Type:** SW + BESLUIT · **Pakket:** 4

- **Auditbevinding:** afboekformulier bij 26179 vult €3500 in.
- **Onderbouwing:** `OrderDetail.tsx:172` vult `amount: Math.max(outstanding, 0)`. Het formulier voor inkooporders vult **niet** voor (`Purchasing.tsx:103`), dus de bevinding geldt alleen voor klantorders. De database controleert alleen `amount <> 0` en een verplichte reden (`0001:331-332`): er is geen bovengrens, geen koppeling aan het openstaande bedrag en geen goedkeuring; een negatief bedrag is mogelijk.
- **Impact en prioriteit:** voor een fout zijn twee bewuste handelingen nodig (opslaan plus een verplichte reden), dus ik verlaag de voorgevulde waarde naar P2. De ontbrekende grens is het eigenlijke risico en valt onder het besluit hieronder.
- **Oplossing:** bedrag leeg bij openen; voorbeeld van het effect ("openstaand wordt €x") vóór bevestigen; grens in de database (bedrag ≤ openstaand, geen negatieve afboeking zonder aparte route); bij bedragen boven de afgesproken grens een extra bevestiging of de rol finance/admin.
- **Afhankelijkheden en besluiten:** besluit afboekbeleid (grens, wie mag, wat is "klein verschil"; de tolerantie staat nu op €0,01).
- **Omvang en risico:** S voor leegmaken en preview; M met grens en rollen. Risico: bestaande afboekingen moeten geldig blijven (migratie met `not valid` of alleen voor nieuwe rijen).
- **Acceptatie en verificatie:** bedrag leeg bij openen; reden verplicht; boven grens extra stap; saldo-effect zichtbaar; testen op de grens, negatief en meer dan openstaand.

### OMS-003 · Twaalf ongedateerde cashflowposten

**Status:** Bevestigd · **Prioriteit:** P1 → P2 · **Type:** SW (presentatie) + ADM (datums) · **Pakket:** 1

- **Auditbevinding:** alle 12 prognoseposten hebben "no due date".
- **Onderbouwing:** live 12 van 12. Oorzaken in de code: de aanbetalingsdatum van een klantorder bestaat alleen als iemand hem invult (`o.deposit_due_date`, `0002:205`); de EXW-restbetaling vereist een factuurdatum (`b.invoice_date + b.payment_days`, `0002:225-228`); de FOB-restbetaling vereist een ETA (`0002:226`); bij inkooporders moeten beide datums handmatig worden gezet (`0002:287`). De bron-Excel bevat deze datums niet. Het scherm toont de rijen als "no due date" (Dashboard, Reports); er zijn geen totalen, en `v_attention` meldt wel PO's zonder datum (*po_without_due_dates*, `0002:522-523`) maar niet klantorders.
- **Impact en prioriteit:** de prognose is niet misleidend (elke rij zegt het zelf), maar bruikbaar voor liquiditeitsplanning is zij nu niet. De software kan alleen zichtbaar maken; de datums herstellen is administratie. Daarom P2.
- **Oplossing:** per valuta en richting een totaal "met datum" en "zonder datum" (nieuwe view `v_cash_flow_summary`); bovenaan het rapport een duidelijke regel; signaal voor klantorders zonder vervaldatum. Geen enkele datum wordt ingevuld of afgeleid.
- **Afhankelijkheden en besluiten:** betalingsvoorwaarden voor EXW-aanbetaling ("voor ophalen") zijn een bedrijfsregel. De herstelwerkbak met eigenaar/bron valt onder pakket 11 (OMS-035).
- **Omvang en risico:** S. Laag risico: nieuwe view, geen wijziging van bestaande.
- **Acceptatie en verificatie:** de 12 bestaande posten zijn herkenbaar als ongedateerd en staan in een apart totaal per valuta; gedateerde en ongedateerde totalen tellen op tot het bestaande totaal; er verschijnt geen datum die niet is ingevoerd.

### OMS-004 · Geen geruststellende achterstandsmelding zonder datumdekking

**Status:** Gedeeltelijk · **Prioriteit:** P1 → P1 · **Type:** SW · **Pakket:** 1

- **Auditbevinding:** "Nothing is overdue" terwijl datums ontbreken en EXW 26179 een reminder heeft.
- **Onderbouwing:** achterstand wordt alleen berekend met een vervaldatum (`0002:250-253`, `0002:318-321`); zonder datum is de uitkomst 0. De tekst "Nothing is overdue" (`Reports.tsx`, tab Overdue) geeft daardoor een onjuiste geruststelling. De reminder is een apart begrip (`reminder_due`, `0002:258`) en staat in het signaal *exw_payment_reminder* (`0002:496-498`) op het dashboard, maar niet op de Overdue-tab. De signalen bestaan dus wel, alleen niet bij elkaar.
- **Impact en prioriteit:** P1 blijft: een kopregel die zegt "niets achterstallig" bij onbekende datums is misleidend op precies de plek waar u op vertrouwt.
- **Oplossing:** de Overdue-tab splitst in drie tellers: berekende achterstand, EXW-herinneringen, open posten zonder vervaldatum (met bedrag per valuta). De lege-tekst wordt "Geen berekende achterstand; N posten hebben geen vervaldatum".
- **Afhankelijkheden en besluiten:** OMS-003 (dezelfde telling). Wat telt als "achterstand" zonder datum is een bedrijfsbesluit, maar de voorgestelde presentatie vraagt er geen: zij laat de drie begrippen naast elkaar staan.
- **Omvang en risico:** S. Geen wijziging in de berekening zelf.
- **Acceptatie en verificatie:** bij de huidige dataset staat naast "0 achterstallig" de waarschuwing over 12 posten zonder datum en de reminder van 26179; begrippen zijn uitgelegd; testscenario met datum in verleden, in toekomst en zonder datum.

### OMS-005 · Vrijgavebeleid voor verzenden zonder aanbetaling

**Status:** Bevestigd (toestand) · **Prioriteit:** P1 → P1 · **Type:** BESLUIT, dan SW · **Pakket:** 5

- **Auditbevinding:** 26122 staat Shipped met $0 ontvangen en $36.305,10 open aanbetaling.
- **Onderbouwing:** de statusovergang controleert alleen terugzetten, annuleren en afronden (`0002:571-594`); vooruitspringen (ook naar *shipped*) is altijd toegestaan, en het statusveld laat elke vooruitliggende status zien (`OrderDetail.tsx:65`). Wel bestaat de waarschuwing *deposit_missing* voor status "in productie" of hoger met onbetaalde aanbetaling (`0002:500-502`). De toestand van 26122 komt uit de werkmap (status "Verscheept"); de importer neemt statussen over zonder ze te bevorderen of te blokkeren (`importer.ts:340-345`).
- **Impact en prioriteit:** kredietrisico is een bedrijfsvraag. Het systeem signaleert al; het blokkeert niet. P1 blijft vanwege het bedrag, maar de oplossing hangt volledig aan uw besluit.
- **Oplossing:** afhankelijk van het besluit: (a) alleen signaleren (bestaat), (b) blokkeren tenzij aanbetaling gedekt, (c) blokkeren met gemotiveerde, vastgelegde uitzondering door een bevoegde rol (nieuwe tabel `order_overrides` met reden, persoon, tijdstip). Bestaande orders worden niet aangepast; geïmporteerde uitzonderingen blijven als zodanig zichtbaar.
- **Afhankelijkheden en besluiten:** besluit 1 (kredietbeleid) en besluit over wie een uitzondering mag geven; sluit aan op OMS-008.
- **Omvang en risico:** M. Risico: een harde blokkade kan lopende, legitieme werkwijzen (bijvoorbeeld bekende klanten op rekening) stoppen. Daarom eerst de keuze (a)/(b)/(c).
- **Acceptatie en verificatie:** testscenario's voor volledig betaald, onvoldoende betaald en geautoriseerde uitzondering; 26122 blijft ongewijzigd en uitlegbaar.

### OMS-006 · Signaleer Shipped zonder gekoppelde zending

**Status:** Bevestigd · **Prioriteit:** P1 → P2 · **Type:** SW (signaal); herstel is ADM · **Pakket:** 1

- **Auditbevinding:** 26122 toont Shipped en "Shipment none yet".
- **Onderbouwing:** live precies 1 zo'n order. `v_attention` bevat geen controle op ontbrekende zending (alleen *shipment_awaiting_info*, voor bestaande zendingen, `0002:528-530`); op de orderpagina staat "none yet" (`OrderDetail.tsx`, blok Order) maar zonder waarschuwing.
- **Impact en prioriteit:** geen financiële afwijking door de app; wel een gemiste controle. P2.
- **Oplossing:** nieuw signaal *shipped_without_shipment* (waarschuwing) voor status verscheept/geleverd zonder `shipment_orders`-koppeling; zichtbaar op dashboard en in "Next actions" van de order. Er verandert niets aan de status van bestaande orders. Afdwingen bij een nieuwe overgang hoort bij het besluit in OMS-005.
- **Afhankelijkheden en besluiten:** geen voor het signaal; afdwingen via OMS-005. Het aanmaken van de ontbrekende zending (of motiveren dat er geen is) is **ADM**.
- **Omvang en risico:** S. Een `union` toevoegen aan `v_attention` is verenigbaar met bestaande schermen.
- **Acceptatie en verificatie:** 26122 verschijnt als signaal; na koppelen van een zending verdwijnt het; scenariotest toegevoegd; de badge-telling blijft kloppen (OMS-012).

### OMS-007 · Auditregels herleidbaar tot gebruiker en record

**Status:** Gedeeltelijk · **Prioriteit:** P1 → P1 · **Type:** SW · **Pakket:** 3

- **Auditbevinding:** kolommen WHEN, RECORD, ACTION, CHANGE; actor en zakelijk record ontbreken.
- **Onderbouwing:** de gebruiker wordt wél vastgelegd: `audit_log.changed_by` (`0003:33`, gevuld door `trg_audit` met `app_user_id()`, `0003:45`), bevestigd door een test (`scenarios.test.ts:286-287`). Live hebben 83 van 84 regels `changed_by = NULL` omdat de eerste data via een load is ingelezen, geen gebruiker. De weergave toont alleen `table_name` (`Admin.tsx:9-14`, kolom "Record") en een veldverschil. Recordverwijzing bestaat in `row_id` en in `new_data`/`old_data` (PI-nummer, PO-nummer, naam).
- **Impact en prioriteit:** P1 blijft: dit is de basis om alle latere correcties te kunnen onderzoeken en kost weinig.
- **Oplossing:** nieuwe view `v_audit_log` die `changed_by` koppelt aan `profiles.full_name` en een leesbaar recordlabel afleidt (PI, PO, klant, product, regel van PI …); regels zonder gebruiker tonen "Systeem / import (geen gebruiker)". Links naar het record. Geen bestaande regels worden aangepast.
- **Afhankelijkheden en besluiten:** geen. Beperking: een e-mailadres staat in `auth.users`, niet in `profiles`; de naam komt uit `profiles.full_name` (bij uw eigen profiel "Sander").
- **Omvang en risico:** M. Rijen van tabellen zonder `id` (voorwaarden, kostregels, instellingen) hebben geen `row_id`; het label komt dan uit de rijgegevens.
- **Acceptatie en verificatie:** elke nieuwe mutatie toont gebruiker en zakelijk record; de 83 bestaande regels staan als onbekende gebruiker; de test van `changed_by` blijft slagen; uitgebreid met een test voor het label.

### OMS-008 · Bevestig en toets leesrechten per rol

**Status:** Bevestigd (als ontwerp) · **Prioriteit:** P1 → P2 · **Type:** BESLUIT, dan SW · **Pakket:** 3

- **Auditbevinding:** "All roles can read everything"; alleen admin Sander is beschikbaar.
- **Onderbouwing:** de leespolicy is voor elke tabel `app_role() is not null` (`0003:85`); het besluit staat in de code ("All three roles can read everything", `0003:68-69`). Schrijfrechten per rol worden getest (finance kan geen orders wijzigen maar wel betalingen boeken; operations kan geen betalingen boeken; gebruiker zonder profiel ziet niets; auditlog is niet schrijfbaar; `scenarios.test.ts:264-288`). Er is geen apart exportrecht: CSV wordt in de browser gemaakt uit wat de gebruiker mag lezen (`ui.tsx:66`).
- **Impact en prioriteit:** met één gebruiker is er nu geen risico; P2. Het wordt P1 zodra een tweede of derde rol (bijvoorbeeld operations of de CFO) wordt toegevoegd.
- **Oplossing:** de rechtenmatrix per tabel/view vaststellen (lezen, schrijven, exporteren) en daarna policies per rol aanscherpen (bijvoorbeeld kosten en marge verbergen voor operations via aparte views zonder kostkolommen). Negatieve tests per rol.
- **Afhankelijkheden en besluiten:** besluit 7 (rechtenmatrix). Geen aanpassing zonder goedgekeurd beleid.
- **Omvang en risico:** M. Risico: te strakke policies kunnen schermen laten falen die kostkolommen gebruiken; daarom per rol aparte views en tests voor alle schermen.
- **Acceptatie en verificatie:** goedgekeurde matrix; negatieve roltests in de testomgeving; geen claim op basis van verborgen knoppen.

### OMS-009 · Historische marge-effecten van kostregelwijzigingen

**Status:** Gedeeltelijk, en ernstiger dan beschreven · **Prioriteit:** P1 → P1 (eerst in de volgorde) · **Type:** SW + BESLUIT · **Pakket:** 2

- **Auditbevinding:** het productformulier waarschuwt dat nieuwe regels gelden voor orders zonder leveranciersfactuur.
- **Onderbouwing:** de berekening kiest de kostregel met de laatste `valid_from` op of vóór de orderdatum (`0002:78-82`), dus versies met ingangsdatum zijn technisch mogelijk. Het productformulier gebruikt dat niet: bij opslaan wordt de **bestaande rij overschreven** (`Master.tsx:115`, `update("product_cost_rules", …, valid_from: ex.valid_from)`). Kosten worden alleen bevroren als een leveranciersfactuur wordt ingevoerd (`0002:638-649`), en de bevriezing slaat afgeronde en geannuleerde orders over (`0002:646`). Gevolg: de marge van een **afgeronde order zonder leveranciersfactuur** (bijvoorbeeld een verkoop uit NL-voorraad) verandert mee met een latere regelwijziging. De audit zag dit niet omdat er nog geen afgeronde orders zijn.
- **Impact en prioriteit:** P1 en eerste in de volgorde: het gaat om stilzwijgend herschrijven van historische winst.
- **Oplossing:** (1) productformulier maakt een **nieuwe versie** met "geldig vanaf" (standaard vandaag) en laat de oude staan; (2) vóór opslaan een impactoverzicht van de orders en perioden die erdoor veranderen (alleen niet-bevroren, op of na de ingangsdatum) met marge vóór en na; (3) afgeronde orders krijgen bij afronden bevroren kosten, zodat zij nooit meer verschuiven.
- **Afhankelijkheden en besluiten:** besluit 2 (kostenbeleid: wanneer worden kosten definitief; moet een wijziging met terugwerkende kracht mogelijk zijn). Voorstel: standaard geen terugwerkende kracht; een eerdere ingangsdatum kan, met preview en bevestiging.
- **Omvang en risico:** L. Risico: bestaande rijen blijven één versie per product en type; de migratie voegt bij afronden bevriezen toe en wijzigt geen bestaande bedragen.
- **Acceptatie en verificatie:** een wijzigingspreview noemt orders en perioden; vastgestelde kosten blijven beschermd; voorlopig versus definitief is zichtbaar op dashboard en rapport; test: afgeronde order zonder leveranciersfactuur verandert niet na een nieuwe regel.

### OMS-010 · Impactpreview bij instellingswijzigingen

**Status:** Bevestigd, met extra risico · **Prioriteit:** P1 → P1 · **Type:** SW · **Pakket:** 2

- **Auditbevinding:** het formulier waarschuwt dat elke berekening die de instelling gebruikt verandert.
- **Onderbouwing:** `app_settings.value` is `text not null` zonder controle (`0001:10-14`); `setting_num()` zet het om naar een getal (`0002:7-8`) en `cost_decimals` naar een geheel getal (`0002:48`). Een ongeldige waarde (tekst, of 100 decimalen) laat daarom elke view die `setting_num` gebruikt falen. De formulierwaarschuwing staat in `Admin.tsx:97`. Wijzigingen worden wel in het auditlog gezet (`0003:65`). Een impactpreview bestaat niet.
- **Impact en prioriteit:** P1: één verkeerde invoer kan alle schermen onbruikbaar maken en bedragen verschuiven.
- **Oplossing:** per instelling een type en grenzen (databasecontrole, bijvoorbeeld `cost_decimals` 0-6, `payment_tolerance` 0-1, werkdagen/dagen 0-365, `reporting_currency` uit de toegestane lijst); formulier met oude en nieuwe waarde en een preview van het effect op open, niet-bevroren orders en PO's (marge, openstaand), berekend zonder opslaan.
- **Afhankelijkheden en besluiten:** besluit 2 en OMS-007 (zichtbare actor). Per instelling vastleggen of een wijziging alleen vanaf nu geldt (nu het geval) of ook historische, niet-bevroren bedragen raakt.
- **Omvang en risico:** M. De preview vraagt een rekenroute die de instelling tijdelijk overschrijft (bijvoorbeeld via een sessie-instelling zoals nu al voor `app.today`), zonder iets op te slaan.
- **Acceptatie en verificatie:** oude/nieuwe waarde en effect zichtbaar; ongeldige waarden geweigerd (testomgeving); historische werking expliciet vastgelegd; test voor elke grens.

### OMS-011 · Onvolledige geïmporteerde PO's laten beoordelen

**Status:** Gedeeltelijk · **Prioriteit:** P1 → P2 · **Type:** ADM (brondocumenten) + SW (log) · **Pakket:** 9

- **Auditbevinding:** alle vier PO's missen PO-datum en betaaldata; PO 2710 meldt "Created by import".
- **Onderbouwing:** de bron bevat deze velden niet: in de werkmap zijn bij 2808/2809/2744 de kolommen PO-datum, "Datum aanbetaling" en "Datum restbetaling" leeg, en 2710 staat niet op het inkoopblad (de importer maakt een PO aan vanuit orderregels en schrijft die opmerking). De bedragen komen uit de orderregels en zijn dus consistent. De bijbehorende importopmerkingen horen in `import_runs`/`import_issues`, maar die tabellen zijn live **leeg** (0 rijen), omdat de eerste data via een seed is ingelezen. Het scherm voor de laatste import bestaat (`Admin.tsx`, "Last saved import").
- **Impact en prioriteit:** verplichtingen zijn gebaseerd op orderregels, niet verzonnen; wat ontbreekt is herkomst en datum. P2.
- **Oplossing:** (1) de importer éénmalig tegen Supabase uitvoeren om het importlogboek vast te leggen (bestaande records worden overgeslagen, er verandert niets aan bedragen); (2) PO 2710 en de andere PO's zonder datum in een herstelwerkbak zetten (OMS-035) met veld "bron van datum"; (3) datums alleen met bron invullen.
- **Afhankelijkheden en besluiten:** (1) vraagt de databaseverbinding (wachtwoord) van Supabase, die u zelf invoert; (2) brondocumenten voor de datums. Niets wordt afgeleid.
- **Omvang en risico:** M. Risico (1): de importer is idempotent en weigert op verschillen; eerst een droge run tegen een kopie.
- **Acceptatie en verificatie:** het importlogboek is zichtbaar; 2710 staat als te beoordelen uitzondering; bestaande bedragen onveranderd; ontbrekende bronvelden staan apart.

### OMS-012 · Navigatiebadge en aandachtsteller begrijpelijk maken

**Status:** Bevestigd, en verklaard · **Prioriteit:** P2 → P2 · **Type:** SW · **Pakket:** 1

- **Auditbevinding:** badge 6 tegenover kop 11.
- **Onderbouwing:** de badge telt alleen *Action* en *Check* (`App.tsx:49`: `severity !== "info"`); de kop telt alle signalen (`Dashboard.tsx:75`). Live: 11 signalen waarvan 5 *Info*, dus 6 + 5 = 11. De audit vermoedde dit al; het is nu bewezen.
- **Impact en prioriteit:** verwarrend, maar niet verkeerd. P2.
- **Oplossing:** één telfunctie voor beide; kop wordt "Needs attention · 6 + 5 info"; de badge krijgt een tooltip met de telregel.
- **Afhankelijkheden en besluiten:** geen.
- **Omvang en risico:** S, laag risico.
- **Acceptatie en verificatie:** badge en lijst hebben dezelfde, zichtbare telregel; filteren toont de bijbehorende aantallen.

### OMS-013 · PI sent-status zonder verzenddatum

**Status:** Gedeeltelijk · **Prioriteit:** P2 → P2 · **Type:** SW (uitleg) + ADM (datums) · **Pakket:** 5

- **Auditbevinding:** vier orders tonen een streepje bij PI sent.
- **Onderbouwing:** de werkmap heeft geen kolom voor de PI-datum (PI overzicht heeft PO-datum, maar geen "PI verstuurd op") en de importer zet `pi_date` niet. Het veld wordt alleen automatisch gevuld bij de overgang uit concept (`0002:596-598`). De reminder wordt berekend vanaf `coalesce(pi_date, po_date)` (`0002:230`), terwijl de instellingsomschrijving "after the PI date" zegt (`0001:15`). Dus "Reminder from 6 Nov" gebruikt de PO-datum zonder dat dit wordt getoond. Voor concepten wordt de reminderdatum ook berekend (zichtbaar bij Soepele Gewrichten, 17 november) maar nooit als signaal gegeven (`0002:258`).
- **Impact en prioriteit:** onduidelijk, geen foute bedragen. P2.
- **Oplossing:** de orderpagina toont de gebruikte brondatum bij de reminder ("vanaf PO-datum, PI-datum ontbreekt"); reminder niet tonen voor concepten; ontbrekende PI-datum als signaal; bij nieuwe status "PI sent" de datum vragen of de reden vastleggen.
- **Afhankelijkheden en besluiten:** besluit 4 (welke datum is de basis voor de reminder). **Geen afleiding van PI-datum uit PO-datum.**
- **Omvang en risico:** M. Het afdwingen van een PI-datum bij statuswijziging raakt de statusroute (pakket 5).
- **Acceptatie en verificatie:** bestaande dossiers tonen de ontbrekende datum; nieuwe statusflow verzamelt datum of reden; reminder toont brondatum; concept toont geen reminder.

### OMS-014 · Documentcontrole per type in plaats van één vinkje

**Status:** Bevestigd · **Prioriteit:** P2 → P2 · **Type:** SW + BESLUIT · **Pakket:** 8

- **Auditbevinding:** "Documents complete (BL / CI / PL / COO)" is één checkbox.
- **Onderbouwing:** `shipments.docs_complete boolean` (`0001:267-278`). Er bestaat een tabel `attachments` met `doc_type` (PI, CI, PL, BL, COO, other) en `storage_path` (`0001:337-345`), maar geen scherm of bestandsopslag gebruikt hem.
- **Impact en prioriteit:** niet zichtbaar welk document er is. P2.
- **Oplossing:** per zending een lijst met documenttypen (status, referentie, versie, link of bestand); "complete" volgt een checklist per route; het bestaande vinkje wordt "legacy, niet bevestigd".
- **Afhankelijkheden en besluiten:** besluit 9 (documentvereisten per route, opslag: Supabase Storage of alleen links).
- **Omvang en risico:** L. Risico: bestandsopslag en privacy van documenten; eerst alleen referenties en links.
- **Acceptatie en verificatie:** BL/CI/PL/COO afzonderlijk zichtbaar; "Complete" alleen volgens de checklist; bestaande vinkje wordt gemarkeerd, niet gewist.

### OMS-015 · Forwarders als selecteerbare relaties

**Status:** Bevestigd · **Prioriteit:** P2 → P3 · **Type:** SW + BESLUIT · **Pakket:** 8

- **Onderbouwing:** `shipments.forwarder text` (`0001:267-278`); vrij tekstveld in `Operations.tsx`. Er is één zending in de data.
- **Impact en prioriteit:** spelfouten en dubbelingen spelen pas bij meer zendingen. P3 tot er meerdere forwarders zijn.
- **Oplossing:** tabel `forwarders` met contact en archivering; migratie die bestaande tekstwaarden koppelt zonder verlies.
- **Afhankelijkheden en besluiten:** is forwarderbeheer nodig of volstaat tekst.
- **Omvang en risico:** M, laag risico bij behoud van de oude tekst.
- **Acceptatie en verificatie:** bestaande forwarder kiesbaar; dubbelingencontrole; oude tekst blijft traceerbaar.

### OMS-016 · Ontbrekende ETD/ETA vullen en bewaken

**Status:** Gedeeltelijk (signaal bestaat) · **Prioriteit:** P2 → P2 · **Type:** SW (bewaking), ADM (datums) · **Pakket:** 8

- **Onderbouwing:** de enige zending heeft geen ready/ETD/ETA en geen forwarder (live). Het signaal *shipment_awaiting_info* bestaat al (`0002:528-530`). Wijzigingen aan zendingen worden in het auditlog bewaard (`0003:56`), maar de ETA-geschiedenis wordt niet getoond. De FOB-vervaldatum is `ETA − 10 dagen` (`0002:226`), dus een ETA-wijziging verschuift de betaaldatum zonder dat dit zichtbaar wordt. Er is geen `etd <= eta`-controle (`0001:267-278`).
- **Impact en prioriteit:** P2.
- **Oplossing:** ETA-historie tonen (uit het auditlog), bij ETA-wijziging de nieuwe vervaldatum van de FOB-restbetaling tonen vóór opslaan, databasecontrole `etd <= eta` en `ready <= etd` voor nieuwe waarden.
- **Afhankelijkheden en besluiten:** geen voor de bewaking; datums invullen is **ADM**.
- **Omvang en risico:** M. De controle op datumvolgorde geldt alleen voor nieuwe of gewijzigde rijen.
- **Acceptatie en verificatie:** de bestaande zending is zichtbaar als "planning onvolledig"; ETA-wijziging toont betaalimpact; tests voor ETA < ETD.

### OMS-017 · Koppelingen aan orders en PO's zichtbaar en beheerbaar

**Status:** Gedeeltelijk · **Prioriteit:** P2 → P2 · **Type:** SW · **Pakket:** 8

- **Auditbevinding:** nieuw formulier heeft één PI en één PO; bewerken toont ze niet.
- **Onderbouwing:** de database staat **één zending per PI** toe (unieke index, `0001:289`, bewust: "decision 21") maar meerdere PI's/PO's per zending (meerdere rijen in `shipment_orders`, `0001:281-286`). Het formulier maakt precies één koppeling bij aanmaken; bij bewerken ontbreken de keuzevelden (`Operations.tsx`, `dlg?.row ? [] : …`). Het keuzeveld PI sluit orders met een bestaande zending en concepten uit.
- **Impact en prioriteit:** een verkeerde koppeling kan nu niet in de interface worden hersteld. P2.
- **Oplossing:** detail van een zending met de gekoppelde PI's en PO's, en een gecontroleerde koppel/ontkoppel-flow met audit; cardinaliteit (één zending per PI) blijft tot u anders besluit.
- **Afhankelijkheden en besluiten:** besluit 10 (meerdere containers per PI / meerdere PI's per container).
- **Omvang en risico:** M.
- **Acceptatie en verificatie:** detail toont de koppelingen; herstel met impactpreview en audit; test van de unieke-index-regel blijft.

### OMS-018 · Verkopen zonder batchtoewijzing

**Status:** Gedeeltelijk (ontwerp) · **Prioriteit:** P2 → P2 · **Type:** SW + BESLUIT · **Pakket:** 7

- **Auditbevinding:** Best Bright 500 verkocht, NL stock 1084 en 0 sold; beide EXW-regels hebben geen batch.
- **Onderbouwing:** voorraad daalt alleen voor orderregels met een `batch_item_id` (`0002:360-362`); de producttabel "Sold" telt alle verkopen (`v_product_sales`, `0004:28-33`). Het verschil is dus ontwerp, geen fout: verkoop uit NL-voorraad is een expliciete keuze op de regel. Er zijn signalen voor *FOB uit NL-voorraad* en *verkocht uit voorraad zonder PO* (`0002:470-474`). Het ontbreekt aan een expliciet begrip "levering rechtstreeks" versus "uit NL-voorraad" op de regel.
- **Impact en prioriteit:** misinterpretatie van voorraad. P2.
- **Oplossing:** per orderregel een zichtbare leveringsroute; labels in het scherm verduidelijken wat "Sold" betekent in het productoverzicht en in NL stock.
- **Afhankelijkheden en besluiten:** besluit 8 (leveringsroute en afboekmoment). De 500 stuks historisch worden eerst zakelijk beoordeeld, niet automatisch toegewezen.
- **Omvang en risico:** M.
- **Acceptatie en verificatie:** route per regel zichtbaar; directe levering vermindert geen NL-voorraad; batchroute wel; scenariotest.

### OMS-019 · Ontvangstdatum en ontvangen hoeveelheid onderscheiden

**Status:** Bevestigd · **Prioriteit:** P2 → P3 · **Type:** SW · **Pakket:** 6

- **Onderbouwing:** in `Operations.tsx` (tabel "Per batch and product") heten twee kolommen beide "Received": een datum en een aantal.
- **Impact en prioriteit:** cosmetisch maar verwarrend; P3, snelle winst.
- **Oplossing:** "Received on" en "Quantity received".
- **Afhankelijkheden en besluiten:** geen. **Omvang en risico:** S, geen risico.
- **Acceptatie en verificatie:** koppen en export ondubbelzinnig.

### OMS-020 · Voorraadgrenzen en correctieredenen

**Status:** Gedeeltelijk · **Prioriteit:** P2 → P2 · **Type:** SW + BESLUIT · **Pakket:** 7

- **Onderbouwing:** negatieve voorraad wordt niet voorkomen maar wel gesignaleerd als fout (*negative_stock*, `0002:476-477`; getest op signaal, `scenarios.test.ts:259`). Bij een correctie zijn soort, datum, referentie en notitie niet verplicht (`stock_adjustments`, `0001:186-195`); alleen `quantity <> 0` wordt gecontroleerd. Er zijn geen tests voor negatieve voorraad bij schrijven, verkeerde batchkeuze of gelijktijdige verkoop.
- **Impact en prioriteit:** P2.
- **Oplossing:** reden verplicht bij correctie; waarschuwing of blokkade bij negatieve uitkomst (besluit); herkenbare actor door OMS-007; tests voor retour, telling, schade en gelijktijdigheid.
- **Afhankelijkheden en besluiten:** besluit 8; testomgeving (OMS-037).
- **Omvang en risico:** M.
- **Acceptatie en verificatie:** regelset afgesproken; grens- en gelijktijdigheidstests; originele beweging blijft traceerbaar.

### OMS-021 · Kwaliteitsindicatoren voor productstamdata

**Status:** Bevestigd (datatoestand) · **Prioriteit:** P2 → P2 · **Type:** ADM (gegevens) + SW (indicator) · **Pakket:** 10

- **Onderbouwing:** `products.sku` is niet verplicht en niet uniek (`0001:99-104`); alleen `name` is uniek. De kostregelkolommen tonen al "no rule" per route (`Master.tsx`, functie `rule`). Live: 7 van 10 SKU's leeg; dat is data, geen softwarefout.
- **Impact en prioriteit:** P2; zonder identifiers is zoeken en bestellen kwetsbaar.
- **Oplossing:** volledigheidsindicator per verkooproute (alleen waarschuwen voor een route die daadwerkelijk wordt gebruikt); unieke SKU zodra ingevuld (unieke index die lege waarden toestaat).
- **Afhankelijkheden en besluiten:** besluit 11 (SKU-beleid en uitzonderingen). SKU's invullen is **ADM**.
- **Omvang en risico:** M. Een unieke index vereist eerst controle op bestaande dubbele SKU's (nu geen, want leeg).
- **Acceptatie en verificatie:** geen onterechte fout voor een ongebruikte route; waarschuwing voor een gebruikte route; dubbele SKU geweigerd.

### OMS-022 · Productdossier met varianten en handelsinformatie

**Status:** Bevestigd (uitbreiding, geen gebrek) · **Prioriteit:** P2 → P3 · **Type:** SW + BESLUIT · **Pakket:** 10

- **Onderbouwing:** `products` heeft naam, SKU, soort, leverancier, verpakkingsgegevens en notitie (`0001:99-113`); geen EAN/HS-code/land van herkomst/variantrelatie/media. Er is geen aangetoonde behoefte; deze velden zijn pas nodig voor documentgeneratie (OMS-040).
- **Impact en prioriteit:** P3 totdat documentgeneratie of marktplaatsen het vragen.
- **Oplossing:** alleen bevestigde velden toevoegen; variantgroep met unieke SKU; geen aanpassing zonder gebruikersinterview.
- **Afhankelijkheden en besluiten:** OMS-021; gebruikersbehoefte.
- **Omvang en risico:** L; additieve kolommen, laag migratierisico.
- **Acceptatie en verificatie:** alleen bevestigde velden; variantgroep; documentvelden beschikbaar voor eventuele generatie.

### OMS-023 · Read-only relatiekaarten

**Status:** Bevestigd · **Prioriteit:** P2 → P2 · **Type:** SW · **Pakket:** 10

- **Onderbouwing:** een klik op een klant of leverancier opent direct het bewerkformulier (`Master.tsx`, `onRow={r => setDlg({ row: r })}`); er is geen dossierpagina met orders, betalingen en voorwaarden. De gegevens zijn wel beschikbaar (`v_customer_summary`, `v_supplier_summary`, `0004`).
- **Impact en prioriteit:** onbedoeld bewerken ligt voor de hand; P2.
- **Oplossing:** eerst een leesbare kaart (voorwaarden, orders/PO's, betalingen, tegoed), bewerken als aparte actie.
- **Afhankelijkheden en besluiten:** geen. **Omvang en risico:** M, geen datarisico.
- **Acceptatie en verificatie:** zonder bewerken te lezen; totalen kloppen met de overzichten.

### OMS-024 · Adressen en meerdere contacten

**Status:** Bevestigd (uitbreiding) · **Prioriteit:** P2 → P3 · **Type:** SW + BESLUIT · **Pakket:** 10

- **Onderbouwing:** klanten hebben land, btw-nummer, één contact en e-mail (`0001:62-70`); geen adressen of contactrollen. De klantcontactkolom is live voor alle 14 klanten leeg (data).
- **Impact en prioriteit:** pas relevant bij documentgeneratie (OMS-040); P3.
- **Oplossing:** factuur-/leveradres en contactrollen toevoegen alleen als de documenten ze vragen; bestaande gegevens blijven.
- **Afhankelijkheden en besluiten:** OMS-040 en documentpakket.
- **Omvang en risico:** M.
- **Acceptatie en verificatie:** migratie zonder verlies; adressen bruikbaar in order of document.

### OMS-025 · Exacte prijsmatching en kostvoorrang uitlegbaar

**Status:** Gedeeltelijk · **Prioriteit:** P2 → P2 · **Type:** SW · **Pakket:** 2

- **Onderbouwing:** de regel staat al in de Prijsafspraken-ondertitel en in de regelbeschrijving ("override, batch, price agreement, product rule", `OrderDetail.tsx`). De match is exact op 4 decimalen (`0002:66`). Een waarschuwing *price_differs_from_agreement* bestaat (`0002:456-468`) maar alleen voor klantspecifieke afspraken (`a.customer_id = l.customer_id`); standaardafspraken (zonder klant) geven geen waarschuwing. **MOQ wordt opgeslagen maar nergens gebruikt** (niet in `calc_unit_cost`, niet in een signaal). De prijsberekening vóór opslaan (`calc_unit_cost` wordt al aangeroepen voor de "onder kostbasis"-controle, `OrderDetail.tsx`, functie `submitLine`) toont het resultaat niet aan de gebruiker.
- **Impact en prioriteit:** een kleine prijsverandering schakelt onverwacht naar een andere kostbron; P2.
- **Oplossing:** in het regelformulier een rekenvoorbeeld tonen (gekozen bron, waarom alternatieven niet gelden, "afspraak bestaat voor $X"); op de afspraak aangeven dat MOQ informatief is, of MOQ een rol geven (besluit).
- **Afhankelijkheden en besluiten:** besluit 12 (heeft MOQ invloed op kostprijs of alleen als waarschuwing).
- **Omvang en risico:** M. Dezelfde rekenfunctie, dus geen tweede rekenbron.
- **Acceptatie en verificatie:** het rekenvoorbeeld toont bron en reden; grensgevallen prijs/datum/MOQ getest.

### OMS-026 · Overlappende afspraken en geldigheid

**Status:** Gedeeltelijk (afwezigheid bevestigd, gedrag niet getest) · **Prioriteit:** P2 → P2 · **Type:** SW + BESLUIT · **Pakket:** 2

- **Onderbouwing:** er is alleen de controle `valid_to >= valid_from` (`0001:137`); geen controle op overlap of dubbele afspraken. Bij meerdere treffers wint de afspraak met klant, daarna de laatste `valid_from` (`0002:71`); bij gelijke gevallen is de uitkomst niet gegarandeerd. Live zijn er 0 afspraken, dus er is nog geen overlap in de data.
- **Impact en prioriteit:** P2; nu 0 afspraken, risico groeit met gebruik.
- **Oplossing:** controle op overlappende periodes per product/klant/type/prijs (uitsluitingsconstraint of trigger), melding bij conflict; bepalen hoe bij gelijke treffers wordt gekozen.
- **Afhankelijkheden en besluiten:** OMS-025 en besluit 12. **Omvang en risico:** M.
- **Acceptatie en verificatie:** gelijke prioriteit geeft geen stille willekeur; ongeldige periode geweigerd; MOQ-grens getest.

### OMS-027 · Exportvaluta, percentages en statussen expliciet

**Status:** Bevestigd · **Prioriteit:** P2 → P2 · **Type:** SW · **Pakket:** 6

- **Onderbouwing:** de CSV gebruikt dezelfde kolomdefinities als het scherm (`ui.tsx:66`) en valt terug op de ruwe waarde als er geen `value` is gedefinieerd. Daardoor staan marge als breuk (0,1129), de status als code (`pi_sent`) en bedragen zonder valutakolom in de export (`Orders.tsx`). Het downloadknopje bestaat alleen buiten een ingebed scherm (`ui.tsx:87`, `!embedded`); "Copy CSV" werkt overal. De export volgt de zoekfilter.
- **Impact en prioriteit:** verkeerde interpretatie in spreadsheets; P2.
- **Oplossing:** per exporteerbare tabel expliciete exportkolommen: valutakolom bij elk bedrag, marge als percentage of benoemde breuk, leesbare statusnamen, vaste codes in een aparte kolom indien nodig; documenteren welke filter is toegepast.
- **Afhankelijkheden en besluiten:** geen. **Omvang en risico:** S; let op dat kolomnamen in bestaande spreadsheets kunnen verschuiven (communiceren).
- **Acceptatie en verificatie:** elke geldkolom heeft valuta; marge-eenheid ondubbelzinnig; gefilterde export bevat exact de zichtbare rijen.

### OMS-028 · Iconknoppen benoemen, acties bereikbaar in brede tabellen

**Status:** Bevestigd · **Prioriteit:** P2 → P2 · **Type:** SW · **Pakket:** 6

- **Onderbouwing:** de potlood- en prullenbakknoppen hebben geen toegankelijke naam (`OrderDetail.tsx:124-125`, `Operations.tsx` kolom `x`); alleen "Sign out" heeft een `title`. Tabelrijen zijn klikbaar via `onClick` op `<tr>` en niet met het toetsenbord bereikbaar (`ui.tsx`). De zendingentabel heeft 14 kolommen en scrollt horizontaal.
- **Impact en prioriteit:** toegankelijkheid en vindbaarheid; P2.
- **Oplossing:** `aria-label` met actie én record, tooltips; rijen krijgen een echte link of knop in de eerste kolom; actiekolom vast aan de rechterkant (sticky).
- **Afhankelijkheden en besluiten:** geen. **Omvang en risico:** S.
- **Acceptatie en verificatie:** schermlezer noemt actie + record; toetsenbord bereikt de acties; primaire actie zichtbaar bij gangbare breedte.

### OMS-029 · Laden onderscheiden van een echt lege lijst

**Status:** Bevestigd · **Prioriteit:** P2 → P2 · **Type:** SW · **Pakket:** 1

- **Onderbouwing:** `useRows` kent een `loading`-status (`store.tsx`), maar `DataTable` heeft geen laadstatus en toont de `empty`-tekst ("No orders match this filter", "Nothing here yet") zolang er nog geen rijen zijn. Detailpagina's tonen wel "Loading …".
- **Impact en prioriteit:** gebruiker kan denken dat gegevens ontbreken; P2, snelle winst.
- **Oplossing:** `loading`-prop op `DataTable`; pagina's geven `loading` door; tijdens laden een laadindicator, de leegmelding pas daarna.
- **Afhankelijkheden en besluiten:** geen. **Omvang en risico:** S, mechanisch (ongeveer 25 tabellen).
- **Acceptatie en verificatie:** tijdens laden geen definitieve lege boodschap; echt lege lijsten (prijsafspraken, betalingen) blijven duidelijk.

### OMS-030 · Klanttegoed en allocatie als zichtbare workflow

**Status:** Gedeeltelijk · **Prioriteit:** P2 → P2 · **Type:** SW + BESLUIT · **Pakket:** 4

- **Onderbouwing:** tegoed bestaat: overbetaling blijft ongealloceerd (`register_customer_payment`, `0002:724`), `v_customer_credit` (`0002:341-346`) en de Payments-pagina toont "Customer credit" en "Not allocated". Er is **geen actie** om bestaand tegoed aan een andere order toe te wijzen of een betaling te verdelen over meerdere orders: de functie boekt een betaling aan één order. De database ondersteunt meerdere allocaties per betaling (`payment_allocations`, `0001:314-320`). Getest: overbetaling en tegoed (`scenarios.test.ts:177-198`).
- **Impact en prioriteit:** P2; zichtbaar pas bij echte betalingen (nu 0).
- **Oplossing:** actie "Tegoed toewijzen aan order" (en splitsen over orders) met controle op klant, valuta en bedrag, via een databasefunctie; tegoedsaldo per klant zichtbaar op klantkaart.
- **Afhankelijkheden en besluiten:** besluit 6 (allocatiebeleid, terugdraaien).
- **Omvang en risico:** M. Terugdraaien blijft via annuleren en opnieuw boeken.
- **Acceptatie en verificatie:** overbetaling, deelbetaling, meerdere orders en terugdraaien afgedekt; totaalsaldo sluit aan.

### OMS-031 · Factuurverschil en verdeling vooraf zien

**Status:** Gedeeltelijk (logica bestaat, preview ontbreekt) · **Prioriteit:** P2 → P2 · **Type:** SW · **Pakket:** 4

- **Onderbouwing:** het verschil tussen leveranciersfactuur en verwacht bedrag wordt in `v_order_lines` naar verhouding over de regels verdeeld, met de afrondingsrest op de regel met de hoogste inkoopwaarde (`0002:132-155`); een test controleert verdeling, bevriezing en marge (`scenarios.test.ts:219`). Het formulier legt het uit in tekst; de verdeling per regel staat op het PO-scherm pas na opslaan ("Invoice difference").
- **Impact en prioriteit:** onbedoelde margeverschuiving blijft onzichtbaar tot na opslaan; P2.
- **Oplossing:** preview per regel en totaal vóór bevestigen (zelfde berekening als de view, zonder opslaan); afrondingsrest expliciet; na bevestigen definitief en geaudit.
- **Afhankelijkheden en besluiten:** besluit 3 (verdeelsleutel; nu naar inkoopwaarde). **Omvang en risico:** M.
- **Acceptatie en verificatie:** preview telt op tot factuur; afrondingsrest zichtbaar; gewijzigde marges zichtbaar; test op afrondingsgevallen.

### OMS-032 · Ontbrekende rapportagekoersen met bron en dekking

**Status:** Gedeeltelijk (deels al opgelost) · **Prioriteit:** P2 → P2 · **Type:** SW + ADM (koersen) · **Pakket:** 4

- **Onderbouwing:** er zijn 0 koersen. Het dashboard meldt "Needs a USD exchange rate: add one under Admin" (`Dashboard.tsx`), Reports toont "no rate" en Admin → Rates heeft een lege-tekst. De omrekening gebruikt de laatste koers op of vóór de PO-datum en geeft `NULL` zonder koers (`fx_rate`, `0002:29-37`): er wordt niets verzonnen. Het formulier vult de bron vooraf in met "ECB reference rate" (`Admin.tsx`, `initial={{ …, source: "ECB reference rate" }}`), ook als de gebruiker een andere bron gebruikt.
- **Impact en prioriteit:** de gebruiker wordt al gewaarschuwd; het risico zit in de voorgevulde bron. P2.
- **Oplossing:** overzicht van de PO-datums waarvoor een koers ontbreekt; bron niet voorinvullen of verplicht expliciet kiezen; optioneel een gecontroleerde import van ECB-koersen op verzoek.
- **Afhankelijkheden en besluiten:** besluit 5 (koersbeleid: ECB op PO-datum?). Koersen invoeren is **ADM**.
- **Omvang en risico:** S.
- **Acceptatie en verificatie:** betrokken PO-datums zichtbaar; geen automatische fictieve koers; bron weerspiegelt de herkomst; EUR en USD blijven apart beschikbaar.

### OMS-033 · Beheerbare importvoorbereiding in de UI

**Status:** Bevestigd · **Prioriteit:** P2 → P3 · **Type:** SW + BESLUIT · **Pakket:** 9

- **Onderbouwing:** op Supabase toont het tabblad alleen de opdrachtregeltekst (`Admin.tsx`); `importWorkbook` bestaat alleen in de lokale testdatabase (`client.ts`). Voor Supabase vraagt een webimport een atomaire route (bijvoorbeeld een Edge Function of database-RPC met transactie), omdat meerdere losse inserts vanuit de browser niet in één transactie lopen.
- **Impact en prioriteit:** de eerste import is gedaan; de vraag is of de Excel-werkmap blijft bestaan. P3 tot dat besluit er ligt.
- **Oplossing:** pas na bevestigde behoefte: upload, voorbeeld (geen mutatie), rijmelding, aparte geautoriseerde bevestiging; herstelstrategie en dubbele-importcontrole.
- **Afhankelijkheden en besluiten:** besluit 13 (blijft Excel een invoerbron?); testomgeving.
- **Omvang en risico:** L; hoogste migratierisico van alle items.
- **Acceptatie en verificatie:** voorbeeld wijzigt niets; fouten per rij; dubbele import gecontroleerd; bevestiging en herstelstrategie.

### OMS-034 · Opgeslagen weergaven en tijdvakfilters

**Status:** Bevestigd (uitbreiding) · **Prioriteit:** P3 → P3 · **Type:** SW · **Pakket:** 11

- **Onderbouwing:** tabellen zijn doorzoekbaar en sorteerbaar (klik op de kolomkop, `ui.tsx`; dit beantwoordt de onbevestigde sortering uit de audit); Reports kent jaar- en valutafilters, maar geen opgeslagen weergaven of ouderdomsbuckets.
- **Impact en prioriteit:** gemak, geen risico; P3.
- **Oplossing:** prioriteren met gebruikers; EUR en USD blijven gescheiden; definities zichtbaar in exports.
- **Afhankelijkheden en besluiten:** OMS-003; gebruikersbehoefte. **Omvang en risico:** M.
- **Acceptatie en verificatie:** definities en filters blijven zichtbaar in export; valuta's gescheiden.

### OMS-035 · Signalen opvolgbaar met eigenaar en deadline

**Status:** Bevestigd (uitbreiding) · **Prioriteit:** P2 → P3 · **Type:** SW + BESLUIT · **Pakket:** 11

- **Onderbouwing:** `v_attention` is een berekende view (`0002:444-530`), zonder opslag van eigenaar, deadline of afhandeling; een signaal verdwijnt vanzelf zodra de data is hersteld, wat het gewenste gedrag "blijft zichtbaar tot herstel" al geeft. Persistente taken vragen een nieuwe tabel.
- **Impact en prioriteit:** met één gebruiker beperkt; P3.
- **Oplossing:** koppeltabel `attention_actions` (eigenaar, deadline, gemotiveerde uitzondering) die aan een signaal hangt; geen dubbele taken.
- **Afhankelijkheden en besluiten:** OMS-003 en OMS-007; meerdere gebruikers.
- **Omvang en risico:** M.
- **Acceptatie en verificatie:** dubbele signalen stapelen niet op; afhandeling heeft reden; dataprobleem blijft zichtbaar tot herstel.

### OMS-036 · Klant en type wijzigen bij bestaande orderregels

**Status:** Gedeeltelijk · **Prioriteit:** P2 → P2 · **Type:** SW + BESLUIT · **Pakket:** 5

- **Onderbouwing:** het ordertype kan niet meer wijzigen zodra er een geldige betaling op staat (`0002:565-569`, getest in `scenarios.test.ts:138-139`). Zonder betaling kan type én klant wel worden gewijzigd (`OrderDetail.tsx`, formulier "Edit order"), ook met regels, factuur of gekoppelde PO. Aanbetaling% en betaaltermijn worden alleen bij aanmaken uit de klantvoorwaarden gekopieerd (`0002:537-547`) en worden bij een wijziging niet opnieuw bepaald. Een gekoppelde PO in een andere valuta telt niet mee voor de PO (`counts_for_po`, `0002:129`), zonder melding.
- **Impact en prioriteit:** mogelijke inconsistentie van valuta en voorwaarden; P2.
- **Oplossing:** blokkeren of een expliciete conversieflow (met preview) zodra er regels, factuur of PO-koppelingen zijn; klantwijziging na betaling blokkeren; melding bij valutaverschil tussen regel en PO.
- **Afhankelijkheden en besluiten:** besluit 14 (mag type/klant wijzigen na regels?). **Omvang en risico:** M.
- **Acceptatie en verificatie:** wijzigen bij regels/betalingen/factuur heeft afgesproken gedrag; geen stille valutaomlabeling; impact op voorwaarden en PO zichtbaar.

### OMS-037 · Kritieke validatie en herstelpaden buiten productie verifiëren

**Status:** Gedeeltelijk · **Prioriteit:** P2 → P2 · **Type:** SW (tests) · **Pakket:** V (doorlopend; start in pakket 1)

- **Onderbouwing:** er is al een omgeving buiten productie: 16 scenariotests plus importtests draaien op dezelfde migraties in een ingebedde Postgres (`tests/scenarios.test.ts`, `tests/import.test.ts`), en de app heeft een lokale testmodus met dezelfde database in de browser. Gedekt: kostprioriteit, onder kostbasis, betalen/deelbetalen/overbetalen, dubbele en verkeerde betalingen, void, annuleren, statusregels, factuurverschil en bevriezing, NL-voorraad, auditlog en rollen. **Niet gedekt:** negatieve voorraad bij schrijven, ETA vóór ETD (er is geen controle), prijsafspraken-overlap, afboeklimiet, dubbel klikken, netwerkfouten, gelijktijdigheid, schermtests. De tests draaien niet automatisch: de bestaande GitHub-workflow bouwt alleen en voert `npm test` niet uit.
- **Impact en prioriteit:** P2; bepaalt hoe veilig de overige pakketten zijn.
- **Oplossing:** testen automatisch laten draaien vóór elke deploy; per pakket de bijbehorende scenario's toevoegen; een staging-database (tweede Supabase-project of lokale modus met de importdata) voor schrijftests met echte rollen.
- **Afhankelijkheden en besluiten:** besluit 15 (staging: tweede gratis Supabase-project of alleen lokaal).
- **Omvang en risico:** L over de hele reeks; stap 0 is S.
- **Acceptatie en verificatie:** resultaat per scenario met bewijs; geen productiegegevens gewijzigd; regressietests op bedrijfsregels, niet op veronderstelde techniek.

### OMS-038 · Taal en terminologie consistent

**Status:** Bevestigd · **Prioriteit:** P3 → P3 · **Type:** SW + BESLUIT · **Pakket:** 10

- **Onderbouwing:** de interface is Engels, maar de opzoektabellen zijn Nederlands en worden ongewijzigd getoond: producttypen (`product_kinds`), correctiesoorten (`stock_adjustment_kinds`: Telling/Schade/Retour/Overig) en de statusnamen in de tabel `order_statuses` (de interface gebruikt een eigen Engelse lijst in `format.ts`). Zie `0001:29-51` en `Master.tsx`, `Operations.tsx` (waar `k.code` wordt getoond).
- **Impact en prioriteit:** onderdeel van gebruiksgemak; P3.
- **Oplossing:** taalbeleid kiezen en dan labels uit één bron laten komen (label-kolom in de opzoektabellen of vertaaltabel in de app).
- **Afhankelijkheden en besluiten:** besluit 16 (Nederlands of Engels). **Omvang en risico:** S.
- **Acceptatie en verificatie:** formulieren, opties en exports volgen het gekozen beleid; EXW/FOB/PI/PO kort uitgelegd.

### OMS-039 · Gebruikerslevenscyclus vindbaar

**Status:** Gedeeltelijk · **Prioriteit:** P3 → P2 · **Type:** SW + BESLUIT · **Pakket:** 3

- **Onderbouwing:** bewerken van naam en rol bestaat (`Admin.tsx`: klik op een gebruikersrij opent "Edit user", alleen op Supabase) maar is niet zichtbaar als actie. Een gebruiker uitnodigen of deactiveren kan niet: een profiel kan alleen bestaan bij een bestaand inlogaccount in Supabase Auth (`profiles.user_id` verwijst naar `auth.users`) en dat account wordt buiten de app aangemaakt. De app belooft aan een gebruiker zonder rol: "Ask the admin to add you under Admin → Users" (`App.tsx`), terwijl dat daar niet kan. De lijst toont geen e-mailadres.
- **Impact en prioriteit:** verhoogd naar P2: zodra een tweede gebruiker (bijvoorbeeld de CFO) komt, is nu SQL nodig om de rol te geven.
- **Oplossing:** zichtbare "Edit"-knop; uitnodigen en deactiveren via een beveiligde route (Supabase Edge Function met de beheersleutel, uitsluitend voor admin); e-mailadres tonen; uitgelegde stappen in de tekst.
- **Afhankelijkheden en besluiten:** OMS-008 (rechtenmatrix) en besluit 7. De beheersleutel mag nooit in de browser komen.
- **Omvang en risico:** M; beveiligingsgevoelig, daarom na OMS-008.
- **Acceptatie en verificatie:** admin ziet toegang, rol en status; intrekken getest; geen ruimere toegang zonder expliciet besluit.

### OMS-040 · Documentgeneratie en dossierarchief

**Status:** Bevestigd (uitbreiding) · **Prioriteit:** P3 → P3 · **Type:** SW + BESLUIT · **Pakket:** 8

- **Onderbouwing:** er is geen documentgeneratie of archief in de app; de tabel `attachments` bestaat maar wordt niet gebruikt (`0001:337-345`). Het huidige externe documentproces is onbekend.
- **Impact en prioriteit:** handmatig documentwerk is aannemelijk maar niet gemeten; P3.
- **Oplossing:** eerst het huidige proces in kaart brengen; daarna sjablonen en archief; gegenereerde documenten eerst als voorbeeld; geen verzending zonder autorisatie.
- **Afhankelijkheden en besluiten:** OMS-014, OMS-024, besluit 9.
- **Omvang en risico:** L.
- **Acceptatie en verificatie:** versie en brongegevens herleidbaar; voorbeeld vóór verzenden; geen verzending zonder autorisatie.

---

## 4. Uitvoeringsplan in pakketten

### 4.1 Uitgangspunten

- **Eén pakket = één samenhangende, controleerbare oplevering** die u kunt beoordelen voordat het volgende begint. Ik voer niets uit zonder uw opdracht per pakket.
- **Volgorde:** eerst wat financiële juistheid, gegevensbehoud en traceerbaarheid beschermt; daarna werkprocessen; dan stamdata en uitbreidingen. Pakketten zonder besluit gaan voor pakketten die er een nodig hebben.
- **Compatibiliteit:** bestaande views behouden hun kolommen en betekenis; nieuwe kolommen komen aan het einde (`create or replace view` staat niets anders toe); nieuwe functionaliteit krijgt nieuwe views of tabellen, zodat latere modules niet breken. Gegevens worden nooit stilzwijgend herschreven; bestaande administratie blijft staan tot u hem herstelt.
- **Werkwijze per migratie** (geldt voor elk pakket met databasewijziging):
  1. Schrijven als nieuw bestand in `supabase/migrations/` (volgende nummer, `0007…`), nooit een bestaand bestand aanpassen.
  2. Eerst draaien in de PGlite-tests en de lokale testmodus; dan, met uw akkoord, op Supabase toepassen.
  3. Op Supabase bestaan de migraties onder eigen tijdstempels (8 stuks, de berekeningen als drie delen) tegenover 6 genummerde bestanden in de repo. Er komt een overzicht `docs/MIGRATIONS.md` dat bestand ↔ Supabase-migratie koppelt, zodat geen migratie dubbel wordt uitgevoerd en een eventuele automatische deploy vanuit GitHub veilig kan.
  4. Herstel: elke migratie krijgt een terugdraai-notitie (voor views: de vorige definitie opnieuw toepassen; voor nieuwe tabellen: ongebruikt laten). Gegevens worden niet gewijzigd.

### 4.2 Overzicht

| # | Pakket | OMS-items | Grootte | Hangt af van | Besluiten nodig |
|---|---|---|---|---|---|
| **1** | **Onbekend is geen nul** (met stap 0: fundament) | 001, 003, 004, 006, 012, 029 | S–M | — | geen blokkerend |
| 2 | Kostenhistorie en instellingen | 009, 010, 025, 026 | M–L | 1 (stap 0) | 2, 12 |
| 3 | Audit en rechten | 007, 008, 039 | M | 1 | 7 |
| 4 | Betalingsbeheersing en koersen | 002, 030, 031, 032 | M | 3 (OMS-007) | 5, 6, 3, 17 |
| 5 | Ordervrijgave en tijdlijn | 005, 013, 036 | M | 1, 3 | 1, 4, 14 |
| 6 | Export en toegankelijkheid | 019, 027, 028 | S | — (onafhankelijk, kan tussendoor) | — |
| 7 | Voorraad | 018, 020 | M | 3 | 8 |
| 8 | Logistiek en documenten | 014, 015, 016, 017, 040 | L | 3, 5 | 9, 10 |
| 9 | Import en datakwaliteit | 011, 033 | M–L | 3 | 13 |
| 10 | Stamdata en relaties | 021, 022, 023, 024, 038 | M | 8 (voor 022/024) | 11, 16 |
| 11 | Werkoverzicht | 034, 035 | M | 1, 3 | — |
| V | Verificatieprogramma (doorlopend) | 037 | doorlopend | start in 1 | 15 |

Alle 40 items komen precies één keer voor: 6 + 4 + 3 + 4 + 3 + 3 + 2 + 5 + 2 + 5 + 2 + 1 = 40.

**Afwijkingen van de elf voorgestelde pakketten van de audit** (CC-01 t/m CC-11), met reden:

- *CC-01 en CC-02 zijn anders verdeeld.* OMS-003 (cashflow) gaat naar pakket 1 omdat het presentatie is en geen besluit vraagt; OMS-027 (export) gaat naar pakket 6 omdat het niets met financiële juistheid van berekeningen te maken heeft; OMS-002 en OMS-031 blijven bij betalingen (pakket 4).
- *CC-04 is gesplitst:* kostenhistorie en instellingen (pakket 2, vroeg, omdat het bestaande marges kan verschuiven) en koersen (pakket 4). OMS-032 hoort bij betalingen/koersen, niet bij kosten.
- *CC-03 is verkleind:* de ordervrijgave (OMS-005/013/036) staat in pakket 5; OMS-006 (signaal) is naar pakket 1 gehaald omdat het zonder besluit kan.
- *CC-06 (voorraad) is vervroegd t.o.v. logistiek* omdat het minder afhangt van documenten en zendingen.
- *CC-10 is opgesplitst:* de kleine UX-punten (012, 029) in pakket 1, toegankelijkheid in pakket 6, en de werkbak/opgeslagen weergaven (034, 035) in pakket 11.
- *CC-11 (verificatie)* wordt niet als los eindpakket uitgevoerd maar loopt door alle pakketten heen: elk pakket levert zijn eigen tests (pakket V).

### 4.3 Pakket 1 · Onbekend is geen nul (met stap 0)

- **Doel:** het systeem toont nooit meer een gerust of gunstig getal waar de onderliggende gegevens ontbreken. OMS-001, 003, 004, 006, 012, 029.
- **Volgorde en afhankelijkheden:** eerst stap 0, dan de overige onderdelen; geen afhankelijkheden van andere pakketten. Dit pakket maakt later de werkbak en de rapportage betrouwbaar.
- **Stap 0 (fundament, geen functiewijziging):** (a) GitHub-workflow draait `npm test` vóór de deploy en stopt bij een fout; (b) `docs/MIGRATIONS.md` met de koppeling tussen repo-bestanden en Supabase-migraties; (c) bepalen of er een staging-project komt (besluit 15).
- **Scope:**
  - **OMS-001:** nieuwe kolommen `cost_complete`, `cost_missing_lines`, `margin_complete`; `margin_pct` wordt `NULL` bij onvolledige kosten; de UI toont "incompleet" in plaats van een percentage; ook de twee plekken waar marge% in de browser wordt berekend (`Dashboard.tsx`, `Reports.tsx` tab Monthly) gaan naar één bron in de database.
  - **OMS-003:** `v_cash_flow_summary` met totaal met en zonder datum per valuta en richting; zichtbaar op het dashboard en in het rapport.
  - **OMS-004:** tab Overdue met drie tellers (berekend, herinneringen, onbekende datum).
  - **OMS-006:** nieuw signaal *shipped_without_shipment*.
  - **OMS-012:** één telfunctie voor badge en kop.
  - **OMS-029:** laadstatus in alle tabellen.
- **Niet in scope:** herstel van kostprijzen, datums of zendingen (administratie); afdwingen van statusregels (pakket 5).
- **Implementatie:** migratie `0007` (alleen `create or replace view` met kolommen aan het einde, een `union` in `v_attention` en één nieuwe view); aanpassingen in `Dashboard.tsx`, `Orders.tsx`, `OrderDetail.tsx`, `Reports.tsx`, `ui.tsx` (laadstatus), `App.tsx` (badge).
- **Acceptatiecriteria:**
  1. Concept Triventa toont "incompleet" in plaats van 100%, in lijst en detail, met de bekende bedragen nog zichtbaar.
  2. Dashboard en cashflowrapport tonen per valuta het bedrag met en zonder datum; de 12 bestaande posten staan bij "zonder datum"; geen datum is ingevuld.
  3. De Overdue-tab zegt niet meer "Nothing is overdue" zonder te melden dat 12 posten geen datum hebben en dat 26179 een herinnering heeft.
  4. 26122 verschijnt als signaal "verscheept zonder zending"; de status verandert niet.
  5. Badge en kop gebruiken dezelfde, uitgelegde telling.
  6. Geen lijst toont "Nothing here yet" tijdens het laden.
  7. Alle bestaande bedragen (orderwaarde, openstaand, kosten, marge in euro) zijn identiek voor en na de wijziging.
- **Tests:** nieuwe scenariotests (regel zonder kostregel, shipped zonder zending, cashflow met/zonder datum, telling van signalen); een regressievergelijking van de belangrijkste kolommen van `v_orders` en `v_order_lines` op de importdataset voor en na; de bestaande 18 tests blijven slagen.
- **Migratie, compatibiliteit, herstel:** geen datawijziging; bestaande kolommen houden hun betekenis (alleen `margin_pct` kan nu `NULL` zijn); terugdraaien door de vorige viewdefinities opnieuw toe te passen.
- **Oplevermoment:** na deze stap bekijkt u de lokale testmodus (en op staging, als die er is) met de vijf aangewezen schermen (Orders-lijst, order Triventa, Dashboard, Overdue-tab, cashflowrapport). Pas na uw akkoord pas ik de migratie op Supabase toe en deploy ik.

### 4.4 Pakket 2 · Kostenhistorie en instellingen

- **Doel:** historische marges en berekeningen mogen niet stilzwijgend verschuiven. OMS-009, 010, 025, 026.
- **Volgorde:** na pakket 1 stap 0 (testen in de workflow). Eerste onderdeel is de validatie van instellingen (snelle veiligheidswinst), dan kostversies, dan prijsafspraken.
- **Scope:**
  1. Instellingen met type en grenzen in de database en het formulier; impactpreview zonder opslaan (OMS-010).
  2. Productformulier maakt een nieuwe kostversie met "geldig vanaf"; preview van betrokken orders en margeverschil; afgeronde orders bevriezen hun kosten bij afronden (OMS-009).
  3. Rekenvoorbeeld in het regelformulier; overlapcontrole op prijsafspraken; MOQ-rol vastleggen (OMS-025, 026).
- **Beslissingen nodig:** 2 (kostenbeleid), 12 (MOQ).
- **Implementatie:** nieuwe migratie (controles op `app_settings`, bevriezing bij afronden, overlapcontrole, preview-functie met tijdelijke instelling); `Admin.tsx`, `Master.tsx` (Products, Prices), `OrderDetail.tsx`.
- **Acceptatiecriteria:** ongeldige instellingswaarde wordt geweigerd; nieuwe regelversie laat orders vóór de ingangsdatum ongemoeid; afgeronde order zonder leveranciersfactuur verandert niet na een nieuwe regel; preview noemt orders en perioden; overlappende afspraken geweigerd; rekenvoorbeeld toont bron en reden.
- **Tests:** afgeronde order na regelwijziging; terugwerkende ingangsdatum met preview; elke instellingsgrens; overlap en gelijke treffers; MOQ-gedrag.
- **Migratie en herstel:** bestaande kostregels blijven staan als eerste versie; geen bedragen wijzigen; bestaande afgeronde orders krijgen pas bij een nieuwe actie bevroren kosten; controles voor nieuwe of gewijzigde rijen (`not valid` waar nodig).
- **Oplevermoment:** u ziet in de testmodus hoe een kostwijziging vooraf de impact toont en dat een afgeronde order stabiel blijft.

### 4.5 Pakket 3 · Audit en rechten

- **Doel:** elke wijziging herleidbaar tot persoon en zakelijk record; rollen bewust en getest. OMS-007, 008, 039.
- **Volgorde:** OMS-007 eerst (weinig risico, groot nut voor alle volgende pakketten); OMS-008 na besluit 7; OMS-039 na OMS-008.
- **Scope:** `v_audit_log` met gebruikersnaam en recordlabel en links; "Systeem / import (geen gebruiker)" voor de 83 bestaande regels; rechtenmatrix en bijpassende policies met negatieve roltests; gebruikersbeheer (zichtbare bewerkactie, uitnodigen en deactiveren via een beveiligde Edge Function, e-mailadres tonen).
- **Beslissingen nodig:** 7 (rechtenmatrix).
- **Implementatie:** migratie met `v_audit_log`; aanpassing Dashboard (recente activiteit), Admin → Audit log, orderhistorie; later policies en een Edge Function voor gebruikersbeheer (beheersleutel uitsluitend server-side).
- **Acceptatiecriteria:** nieuwe mutaties tonen gebruiker en record; bestaande regels zijn niet herschreven; negatieve roltests slagen; geen gebruiker krijgt meer rechten dan de goedgekeurde matrix.
- **Tests:** uitbreiding van de rolltest (`scenarios.test.ts:264`) per rol voor lezen, schrijven en exporteren; test van het recordlabel.
- **Migratie en herstel:** nieuwe view; policies alleen na uw goedkeuring van de matrix; terugdraaien door de vorige policy-definities.
- **Oplevermoment:** het auditlog met namen en records; daarna de matrix ter goedkeuring voordat ik policies wijzig.

### 4.6 Pakket 4 · Betalingsbeheersing en koersen

- **Doel:** geldstromen vooraf begrijpelijk en beheersbaar. OMS-002, 030, 031, 032.
- **Volgorde:** na pakket 3 (zichtbare actor). Eerst OMS-002 (veiligheid), dan 031 (preview), 030 (tegoed), 032 (koersen).
- **Scope:** leeg afboekbedrag met effect en bovengrens (rol/extra bevestiging boven grens); factuurverdelingspreview; actie "tegoed toewijzen" met controles; overzicht van PO-datums zonder koers en een bronveld zonder voorinvulling.
- **Beslissingen nodig:** 17 (afboekbeleid), 3 (verdeelsleutel), 6 (allocatie), 5 (koersbeleid).
- **Implementatie:** nieuwe databasefuncties (`allocate_credit`, `preview_invoice_variance`), controles op `write_offs`; `OrderDetail.tsx`, `Purchasing.tsx`, `Operations.tsx` (Payments), `Admin.tsx`.
- **Acceptatiecriteria:** zie OMS-002, 030, 031, 032: bedrag leeg; preview telt op tot de factuur; deel-, over- en meervoudige toewijzing sluit aan; geen automatische koers.
- **Tests:** afboeking op de grens, negatief en meer dan openstaand; toewijzing van tegoed aan een andere order; afrondingsgevallen van de verdeling; koers ontbreekt.
- **Migratie en herstel:** nieuwe functies en controles voor nieuwe rijen; bestaande afboekingen blijven geldig.
- **Oplevermoment:** u doorloopt in de testmodus een betaling, overbetaling, toewijzing en een leveranciersfactuur met preview.

### 4.7 Pakket 5 · Ordervrijgave en tijdlijn

- **Doel:** een afgesproken, afdwingbare werkwijze voor vrijgave en tijdlijn. OMS-005, 013, 036.
- **Volgorde:** na pakketten 1 en 3, en na besluit 1.
- **Scope:** kredietbeleid in de statusovergang (waarschuwing, blokkade of gemotiveerde uitzondering met vastlegging); brondatum van de reminder zichtbaar, geen reminder voor concepten, PI-datum vragen of reden vastleggen; controle bij wijziging van klant of type.
- **Beslissingen nodig:** 1 (kredietbeleid), 4 (datumgrondslagen), 14 (type/klant wijzigen).
- **Implementatie:** uitbreiding van `trg_sales_order_status` (`0002:562-608`) en de bijbehorende tabel voor uitzonderingen; `OrderDetail.tsx`.
- **Acceptatiecriteria:** 26122 blijft ongewijzigd en uitlegbaar; nieuwe overgangen volgen het besluit; uitzonderingen zijn terug te zien met persoon en reden.
- **Tests:** betaald, onvoldoende betaald, uitzondering; type/klant na regels; reminder zonder PI-datum.
- **Migratie en herstel:** de triggerwijziging geldt voor nieuwe overgangen; bestaande orders worden niet aangepast; bij een te strenge regel is de trigger terug te zetten.
- **Oplevermoment:** u ziet de statusflow met het gekozen beleid in de testmodus voordat het live gaat.

### 4.8 Pakket 6 · Export en toegankelijkheid

- **Doel:** exports ondubbelzinnig en schermen bruikbaar met toetsenbord en schermlezer. OMS-019, 027, 028.
- **Volgorde:** onafhankelijk; kan tussendoor, bijvoorbeeld na pakket 1.
- **Scope:** exportkolommen met valuta, benoemde marge-eenheid en leesbare statussen; kolomnamen "Received on" en "Quantity received"; `aria-label`s, klikbare rijen als echte link of knop, sticky actiekolom.
- **Beslissingen nodig:** geen. Let op dat bestaande spreadsheets die op kolomnamen leunen kunnen verschuiven (ik meld de wijzigingen).
- **Implementatie:** `ui.tsx` (DataTable), `Orders.tsx`, `Operations.tsx`, `OrderDetail.tsx`.
- **Acceptatiecriteria:** zie OMS-019, 027, 028; gefilterde export blijft precies de zichtbare rijen bevatten.
- **Tests:** een test die de CSV-kolommen en inhoud van de orderexport controleert; handmatige toetsenbord- en schermlezercontrole van de aangepaste knoppen.
- **Migratie en herstel:** geen databasewijziging.
- **Oplevermoment:** een gefilterde orderexport en de zendingenpagina bij normale schermbreedte.

### 4.9 Pakket 7 · Voorraad

- **Doel:** voorraadroute en correcties duidelijk en veilig. OMS-018, 020.
- **Volgorde:** na pakket 3 en besluit 8.
- **Scope:** zichtbare leveringsroute per orderregel; verduidelijkte labels voor "Sold"; reden verplicht bij correcties; gekozen regel voor negatieve voorraad.
- **Beslissingen nodig:** 8.
- **Implementatie:** kolom of veld voor de leveringsroute op `sales_order_lines`; controle op `stock_adjustments`; `Operations.tsx`, `OrderDetail.tsx`.
- **Acceptatiecriteria:** zie OMS-018 en 020. De 500 stuks historische verkoop worden niet automatisch aan een batch gekoppeld.
- **Tests:** verkoop, annulering, retour, telling, schade, negatieve voorraad en gelijktijdige verkoop.
- **Migratie en herstel:** nieuwe veld met een neutrale standaard voor bestaande regels ("niet vastgelegd").
- **Oplevermoment:** een verkoop via beide routes in de testmodus.

### 4.10 Pakket 8 · Logistiek en documenten

- **Doel:** zendingen, planning en documenten beheersbaar. OMS-014, 015, 016, 017, 040.
- **Volgorde:** na pakketten 3 en 5. Eerst 016 en 017 (bewaking en koppelingen), dan 014, daarna 015, en 040 pas na procesinventarisatie.
- **Beslissingen nodig:** 9 (documenten), 10 (cardinaliteit).
- **Scope en implementatie:** ETA-historie en impactpreview, datumvolgorde, zendingdetail met koppelingen; documentchecklist per type (referenties en links eerst); forwarderregister; documentgeneratie alleen na inventarisatie.
- **Acceptatiecriteria:** zie de afzonderlijke items.
- **Tests:** ETA < ETD, koppelen/ontkoppelen, documentchecklist, ETA-wijziging en FOB-vervaldatum.
- **Migratie en herstel:** nieuwe tabellen; het bestaande vinkje en de forwardertekst blijven bewaard.
- **Oplevermoment:** zendingdetail met koppelingen en documentchecklist.

### 4.11 Pakket 9 · Import en datakwaliteit

- **Doel:** herkomst van geïmporteerde gegevens zichtbaar; import veilig te herhalen. OMS-011, 033.
- **Volgorde:** na pakket 3. OMS-011 eerst (het importlogboek vastleggen); OMS-033 alleen als besluit 13 daar aanleiding toe geeft.
- **Beslissingen nodig:** 13; voor OMS-011 de databaseverbinding die u zelf invoert (ik vraag die nooit via chat).
- **Scope:** importlogboek in de live database (idempotente run, geen datawijziging); PO's zonder datum en PO 2710 als te beoordelen uitzondering; later een voorbeeld-/bevestigingsimport.
- **Acceptatiecriteria:** zie OMS-011 en 033; bestaande bedragen onveranderd.
- **Tests:** dubbele import, onvolledige bron, herstel; de bestaande importtests blijven slagen.
- **Migratie en herstel:** de importer slaat bestaande records over; eerst een droge run.
- **Oplevermoment:** Admin → Import toont het laatste importlogboek met de opmerkingen.

### 4.12 Pakket 10 · Stamdata en relaties

- **Doel:** stamdata volledig en herleidbaar. OMS-021, 022, 023, 024, 038.
- **Volgorde:** 021 en 023 eerst; 038 na besluit 16; 022 en 024 pas na pakket 8 en bevestigde behoefte.
- **Beslissingen nodig:** 11 (SKU), 16 (taal).
- **Acceptatiecriteria:** zie de afzonderlijke items.
- **Tests:** unieke SKU, relatiekaart tegenover overzichten, labels in exports.
- **Migratie en herstel:** additieve velden; bestaande gegevens blijven.
- **Oplevermoment:** relatiekaart van een klant en een product met volledigheidsindicator.

### 4.13 Pakket 11 · Werkoverzicht

- **Doel:** signalen krijgen eigenaar en deadline wanneer meerdere mensen werken. OMS-034, 035.
- **Volgorde:** laatste; na pakketten 1 en 3. Hangt af van het aantal gebruikers.
- **Beslissingen nodig:** geen blokkerend.
- **Acceptatiecriteria:** zie OMS-034 en 035.
- **Tests:** dubbele signalen, afhandeling met reden.
- **Migratie en herstel:** nieuwe tabel; signalen blijven berekend.
- **Oplevermoment:** een werkbak met eigenaren en deadlines.

### 4.14 Pakket V · Verificatieprogramma (OMS-037, doorlopend)

- **Doel:** elk pakket levert zijn eigen reproduceerbare bewijs.
- **Scope per pakket:** de scenario's uit de checklist "Checklist voor vervolg in aparte testomgeving" worden aan het pakket gekoppeld dat de regel invoert. De huidige testset blijft als vangnet.
- **Dekking per checklistpunt:**

| Checklistpunt | Nu | Plan |
|---|---|---|
| Statusvoorwaarden en uitzonderingen | getest (`199`) | uitbreiden in pakket 5 |
| Duplicaten PI/PO/SKU, dubbele verzending | betalingen getest; PI/PO uniek in schema; SKU niet | pakketten 10 en 6 |
| Lege/nul/negatieve bedragen; datumvolgorde | schema controleert deels | pakketten 2, 4, 8 |
| Betaling vol/deel/over, creditallocatie, terugdraaien, afboeken | grotendeels getest (`51-91`, `177`) | pakket 4 |
| Voorraad verkoop/annulering/retour/telling | deels (`245`) | pakket 7 |
| Kostvoorrang, MOQ, overlap, factuurverschil | voorrang en verschil getest (`21`, `219`) | pakket 2 |
| Historische wijzigingen en impact | niet getest | pakket 2 |
| Rechten lezen/schrijven/export | schrijven getest (`264`) | pakket 3 |
| Netwerkfout, time-out, gelijktijdige bewerking | niet getest | pakket 5 en V |
| Documentbewijs/versies | niet aanwezig | pakket 8 |
| Responsief, toetsenbord, schermlezer | niet getest | pakket 6 |

---

## 5. Overzicht van noodzakelijke bedrijfsbesluiten

Elk besluit heeft een aanbevolen keuze en het gevolg. Alleen de besluiten van het eerstvolgende pakket hoeven nu; de rest kan per pakket.

| # | Besluit | Raakt | Aanbeveling | Gevolg |
|---|---|---|---|---|
| 1 | **Kredietbeleid:** mag een order verscheept worden zonder gedekte aanbetaling? | 005 | Waarschuwing blijft; blokkade tenzij gedekt of een gemotiveerde uitzondering door admin of finance | Soms een extra stap bij bekende klanten; 26122 blijft ongewijzigd |
| 2 | **Kostenbeleid:** wanneer zijn kosten definitief; mag een kostwijziging terugwerken; wat doet een instellingswijziging met bestaande bedragen? | 009, 010 | Nieuwe versie met ingangsdatum (standaard vandaag); kosten bevriezen bij leveranciersfactuur én bij afronden; instellingswijzigingen alleen vanaf nu | Historische marge blijft stabiel; terugwerkende kracht alleen met preview |
| 3 | **Verdeelsleutel** van het leveranciersfactuurverschil | 031 | Houden zoals nu: naar inkoopwaarde per regel, afrondingsrest op de grootste regel | Geen herberekening van bestaande data |
| 4 | **Datumgrondslagen:** reminderdatum, en wat telt als achterstand zonder vervaldatum | 004, 013 | Reminder vanaf PI-datum, met terugval op PO-datum alleen als zichtbaar gelabeld; onbekende vervaldatum is "onbekend", niet "te laat" | Meer zichtbare onbekenden, geen verzonnen datums |
| 5 | **Koersbeleid** voor het gecombineerde EUR-totaal | 032 | ECB-referentiekoers op de PO-datum, handmatig ingevoerd, bron verplicht | Combineren pas na invoer van koersen |
| 6 | **Allocatiebeleid klanttegoed** en terugdraaien | 030 | Tegoed handmatig toewijzen door finance; terugdraaien via annuleren en opnieuw boeken (bestaand) | Geen automatische toewijzing |
| 7 | **Rechtenmatrix** (lezen, schrijven, exporteren per rol) | 008, 039 | Nu één gebruiker: matrix vastleggen, pas aanscherpen zodra een tweede rol komt; kosten/marge voor operations apart afschermen alleen op uw verzoek | Geen wijziging tot de matrix is goedgekeurd |
| 8 | **Leveringsroute en voorraad:** directe levering versus NL-voorraad; afboekmoment; negatieve voorraad | 018, 020 | Veld per orderregel met twee routes; negatieve voorraad blokkeren | De 500 stuks historisch eerst zakelijk beoordelen |
| 9 | **Documentvereisten** per route en opslag | 014, 040 | Eerst referenties en links, geen bestandsopslag; checklist BL/CI/PL/COO voor FOB | Weinig risico, later uitbreidbaar |
| 10 | **Zending-cardinaliteit** | 017 | Houden bij één zending per PI tot een concreet geval van deelleveringen | Geen wijziging van de unieke index |
| 11 | **SKU-beleid** | 021 | Verplicht voor nieuwe producten, uniek zodra ingevuld | Bestaande lege SKU's blijven geldig |
| 12 | **Rol van MOQ** | 025, 026 | Informatief plus waarschuwing onder MOQ, niet in de kostprijs | Geen verandering van bestaande kostprijzen |
| 13 | **Blijft de Excel-werkmap een invoerbron?** | 033 | Nee → OMS-033 vervalt; ja → upload met voorbeeld | Bepaalt of het grootste risicoitem nodig is |
| 14 | **Klant of type wijzigen na regels** | 036 | Blokkeren zodra regels bestaan; de order annuleren en opnieuw aanmaken | Soms extra handelingen, geen valutaomlabeling |
| 15 | **Staging-omgeving** | 037 | Tweede gratis Supabase-project voor schrijftests, plus de bestaande lokale modus | Geen testen op productiegegevens |
| 16 | **Taal van de interface** | 038 | Eén taal (nu Engels) met Nederlandse opzoeklabels vertaald | Bestaande exports kunnen andere labels krijgen |
| 17 | **Afboekbeleid:** grens, wie mag, wat is een klein verschil | 002 | Tot de tolerantie (nu €0,01) vrij; daarboven rol finance/admin met extra bevestiging; geen negatieve afboeking | Voorkomt grote vergissingen |

---

## 6. Voorstel voor het eerste implementatiepakket

**Aanbeveling: pakket 1, "Onbekend is geen nul", met stap 0.**

### Waarom dit pakket eerst

1. **Het raakt precies de meest gewogen punten van uw opdracht:** financiële juistheid (geen 100% marge zonder kosten, geen "niets achterstallig" zonder datums) en traceerbaarheid (signalen die tonen wat onbekend is).
2. **Er is geen bedrijfsbesluit nodig** en er verandert geen enkel bestaand bedrag. Het is dus bij uitstek veilig als eerste stap.
3. **Het legt het fundament voor alles daarna:** na stap 0 draaien de tests automatisch vóór elke deploy, en het migratieoverzicht staat klaar voor de eerste echte databasewijziging.
4. **Het is klein genoeg** (S–M) om in één keer te beoordelen.

### Concrete wijzigingen

- **Orders-lijst en orderdetail:** waar kosten ontbreken staat "incompleet" (met het aantal regels zonder kostprijs) in plaats van 100%. Voor Triventa/Soepele Gewrichten blijft de omzet van €73,75 zichtbaar, de kosten staan als "onbekend".
- **Dashboard:** de kop "Needs attention" toont "6 + 5 info" en de badge heeft dezelfde telregel; onder de cashflow staat per valuta "met datum" en "zonder datum" (de 12 posten); marge% komt uit de database.
- **Rapport Overdue:** drie tellers (berekend achterstallig, herinneringen, open posten zonder vervaldatum). In plaats van "Nothing is overdue" staat bij de huidige data iets als "Geen berekende achterstand. 12 posten hebben geen vervaldatum; 1 herinnering (26179)."
- **Signalen:** nieuw signaal "verscheept zonder zending" voor 26122.
- **Tabellen:** tijdens het laden staat een laadindicator in plaats van een lege melding.
- **Stap 0 (onzichtbaar voor gebruikers):** testen draaien automatisch bij elke deploy; `docs/MIGRATIONS.md` koppelt de repo-migraties aan de Supabase-migraties.

### Verwachte gebruikerservaring

De cijfers blijven dezelfde; wat verandert is dat onbekende dingen als onbekend worden getoond. Er verschijnen enkele extra meldingen (meer "Check"-signalen: één voor 26122), maar niets wordt dubbel geteld of ingevuld. Wat u vroeger zelf moest afleiden ("is 100% echt?") staat nu op het scherm.

### Blokkerende vragen

Er zijn **geen** vragen die de uitvoering van pakket 1 blokkeren. Drie keuzes waarvan ik de aanbeveling hanteer tenzij u anders wilt:

1. **Incomplete marge in de dashboardtotalen:** wel meetellen (bekende bedragen), met de noot "N regels zonder kostprijs". *Gevolg van het alternatief (uitsluiten): de totalen dalen tot de kosten zijn ingevuld.*
2. **Staging:** voor pakket 1 volstaan de tests en de lokale testmodus; het live zetten gebeurt pas na uw akkoord. Een tweede Supabase-project is pas nodig voor pakket 2 en verder (besluit 15).
3. **Taal van de nieuwe meldingen:** Engels, in lijn met het huidige scherm (besluit 16).

---

## 7. Wat dit plan niet doet

- Het wijzigt geen gegevens, voert geen migratie uit en publiceert niets. Het enige dat aan de repository wordt toegevoegd is dit document.
- Het herstelt geen administratie: ontbrekende kostprijzen (Soepele Gewrichten), PI-datums, vervaldatums, ETA's, forwarders, koersen, SKU's en de batch van de Best Bright-orders blijven aan u; de app maakt ze alleen zichtbaar.
- Het geeft geen uitspraak over productiegeschiktheid, beveiligingscertificering of schaalbaarheid; de audit en deze beoordeling zijn gebaseerd op de interface, de broncode en alleen-lezen controles.
- Na dit plan stop ik en wacht op uw opdracht om een specifiek pakket uit te voeren.

## 8. Bronnen en verificatie

- Audit: `admin-audit.md`, `backlog.md`, `inspectiechecklist.md` (11 november 2026).
- Code: `supabase/migrations/0001`–`0006`, `web/src/**`, `src/import/importer.ts`, `tests/*.test.ts`, `.github/workflows/deploy-web.yml`.
- Live controles (alleen `SELECT`, geen wijzigingen): aantallen in `import_runs`, `import_issues`, `audit_log` (inclusief `changed_by`), `attachments`, `fx_rates`, `price_agreements`, `payments`, `profiles`, `shipments`, en de telling van `v_cash_flow`, `v_attention` en orders die verscheept zijn zonder zending.
- Werkmap: kolomkoppen en lege velden van de bladen PI overzicht, Inkoop orders en Shipping.
- Niet uitgevoerd: de tests zelf zijn voor dit plan niet opnieuw gedraaid; de beschreven teststatus komt uit de testbestanden. De opmerkingen over regelnummers verwijzen naar commit `265e433`.
