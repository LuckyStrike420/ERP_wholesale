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
| `0009_open_items.sql` | `0009_open_items` (plus `v_open_items_totals`, los toegepast met dezelfde SQL) | ja (17 nov 2026) |
| `0010_faster_attention.sql` | `0010_faster_attention` | ja (17 nov 2026) |
| `0011_po_from_order.sql` | `0011_po_from_order` | ja (17 nov 2026) |
| `0012_rls_once_per_query.sql` | `0012_rls_once_per_query` | ja (17 nov 2026) |
| `0013_split_write_policies.sql` | `split_write_policies` | ja (17 nov 2026) |
| `0014_order_composer.sql` | `0014_order_composer` | ja (17 nov 2026) |
| `0015_payment_terms.sql` | `0015_payment_terms` | ja (17 nov 2026) |
| `0016_tasks_notes_documents.sql` | `0016_tasks_notes_documents` (plus opslagbucket `documents`) | ja (17 nov 2026) |
| `0017_documents_contacts_views.sql` | `0017_documents_contacts_views` | ja (17 nov 2026) |
| `0018_favorites_notifications.sql` | `0018_favorites_notifications` | ja (17 nov 2026) |
| `0019_automations.sql` | `0019_automations` (plus pg_cron-taak `run-automations`, elk uur) | ja (18 nov 2026) |
| `0020_user_layouts.sql` | `0020_user_layouts` | ja (18 nov 2026) |
| `0021_reports.sql` | `0021_reports` | ja (18 nov 2026) |
| `0022_approvals.sql` | `0022_approvals` | ja (18 nov 2026) |
| `0023_vat.sql` | `0023_vat` | ja (18 nov 2026) |
| `0024_vat_deposit.sql` | `0024_vat_deposit` | ja (18 nov 2026) |
| `0025_permissions.sql` | `0025_permissions` | ja (18 nov 2026) |
| `0026_locations.sql` | `0026_locations` | ja (18 nov 2026) |
| `0027_address_cleared.sql` | `0027_address_cleared` | ja (18 nov 2026) |
| `0028_insights.sql` | `0028_insights` | ja (18 nov 2026) |
| `0029_health_currency.sql` | `0029_health_currency` | ja (18 nov 2026) |
| `0030_bin_rules_rates.sql` | `0030_bin_rules_rates` | ja (18 nov 2026) |
| `0031_landed_costs_stock.sql` | `0031_landed_costs_stock` | ja (18 nov 2026) |
| `0032_landed_fence.sql` | `0032_landed_fence` | ja (18 nov 2026) |
| `0033_delivery_terms.sql` | `0033_delivery_terms` | ja (18 nov 2026) |
| `0034_one_terms_field.sql` | `0034_one_terms_field` | ja (18 nov 2026) |
| `0035_transport_types.sql` | `0035_transport_types` | ja (19 nov 2026) |
| `0036_document_slots.sql` | `0036_document_slots` | ja (19 nov 2026) |
| `0037_own_stock_assembly.sql` | `0037_own_stock_assembly` + `0037_own_stock_attention` (in twee delen toegepast) | ja (20 nov 2026) |

## Regels

1. Een toegepast bestand wordt nooit aangepast; een wijziging is altijd een nieuw bestand met het volgende nummer.
2. Eerst de tests (`npm test`) en de lokale testmodus, dan Supabase, en pas daarna de website. De deploy-workflow draait `npm test` en stopt bij een fout.
3. Views mogen alleen kolommen **achteraan** krijgen (`create or replace view`). Verwijderen of hernoemen vraagt een aparte, bewuste stap.
4. Nieuwe tabellen, views en functies krijgen expliciet `grant ... to authenticated` (zie `0005`).
5. De website verwacht de nieuwe kolommen/views zodra hij is uitgerold. Daarom: **eerst de migratie op Supabase, dan pas de website uitrollen** (en nooit andersom).
6. Terugdraaien van een view-migratie: de vorige viewdefinitie opnieuw toepassen (staat in het vorige bestand). Gegevens worden door deze migraties niet gewijzigd.

## Data vervangen door werkmap V5 (17 nov 2026)

Op verzoek is alle bedrijfsdata (klanten, leveranciers, producten, orders, inkoop, betalingen, voorraad, zendingen, importlog) vervangen door `YP_Order-_en_betaalsheetV5.xlsx`.
Gebruikers, rollen, instellingen en het auditlog zijn gebleven. De volledige vorige stand staat in het schema `backup_20261117` (niet bereikbaar voor de app).
