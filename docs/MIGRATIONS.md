# Migraties: repository ↔ Supabase

De database wordt opgebouwd uit genummerde SQL-bestanden in `supabase/migrations/`. Dezelfde bestanden draaien in de tests (lokale Postgres) en in de lokale testmodus van de app. Op Supabase staan ze onder een eigen tijdstempel; de inhoud is gelijk.

| Repository-bestand | Supabase-migratie (project `wholesale`) | Op Supabase toegepast |
|---|---|---|
| `0001_core_tables.sql` | `0001_core_tables` (20261111104531) | ja |
| `0002_calculations.sql` | `0002a_calculations_core`, `0002b_calculations_views`, `0002c_calculations_rules` (drie delen van één bestand) | ja |
| `0003_audit_and_access.sql` | `0003_audit_and_access` | ja |
| `0004_reporting_views.sql` | `0004_reporting_views` | ja |
| `0005_api_hardening.sql` | `0005_api_hardening` | ja |
| `0006_function_settings.sql` | `0006_function_settings` | ja |
| `0007_unknown_is_not_zero.sql` | `0007_unknown_is_not_zero` | ja (11 nov 2026) |
| `0008_cost_history_and_settings.sql` | `0008_cost_history_and_settings` | ja (11 nov 2026) |

## Regels

1. Een toegepast bestand wordt nooit aangepast; een wijziging is altijd een nieuw bestand met het volgende nummer.
2. Eerst de tests (`npm test`) en de lokale testmodus, dan Supabase, en pas daarna de website. De deploy-workflow draait `npm test` en stopt bij een fout.
3. Views mogen alleen kolommen **achteraan** krijgen (`create or replace view`). Verwijderen of hernoemen vraagt een aparte, bewuste stap.
4. Nieuwe tabellen, views en functies krijgen expliciet `grant ... to authenticated` (zie `0005`).
5. De website verwacht de nieuwe kolommen/views zodra hij is uitgerold. Daarom: **eerst de migratie op Supabase, dan pas de website uitrollen** (en nooit andersom).
6. Terugdraaien van een view-migratie: de vorige viewdefinitie opnieuw toepassen (staat in het vorige bestand). Gegevens worden door deze migraties niet gewijzigd.
