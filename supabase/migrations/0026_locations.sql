-- =====================================================================
-- 0026: real locations.
-- - countries: every country (ISO 3166), with its English name (what is stored), Dutch name and other names.
--   country_name() turns "Croatië", "USA", "NL", "Holland" … into the one stored name, so reports group correctly.
--   Customers, suppliers, shipments and products are normalised on save; existing data is normalised once.
-- - Customers and suppliers get street, street2, postal_code, city; "address" is now made from those parts
--   (it is what documents print). An existing address is split once (last line "postal code + city").
-- - Shipments: port_loading / port_discharge are the city; port_loading_country / port_discharge_country the country.
--   "Ningbo, China" is split once.
-- - Products: a default port of loading (pol_city, pol_country), offered on a new shipment and changeable there.
-- Roll back: drop the new columns, triggers, functions and table countries; re-create v_shipments from 0002 and draft_document from 0017.
-- =====================================================================
create table countries (
  code    char(2) primary key,
  name    text not null unique,
  name_nl text,
  aliases text[] not null default '{}'
);
insert into countries (code, name, name_nl, aliases) values
('AF', 'Afghanistan', 'Afghanistan', array[]::text[]),
('AL', 'Albania', 'Albanië', array[]::text[]),
('DZ', 'Algeria', 'Algerije', array['Algerië']::text[]),
('AS', 'American Samoa', 'Amerikaans-Samoa', array[]::text[]),
('AD', 'Andorra', 'Andorra', array[]::text[]),
('AO', 'Angola', 'Angola', array[]::text[]),
('AI', 'Anguilla', 'Anguilla', array[]::text[]),
('AQ', 'Antarctica', 'Antarctica', array[]::text[]),
('AG', 'Antigua and Barbuda', 'Antigua en Barbuda', array['Antigua & Barbuda']::text[]),
('AR', 'Argentina', 'Argentinië', array[]::text[]),
('AM', 'Armenia', 'Armenië', array[]::text[]),
('AW', 'Aruba', 'Aruba', array[]::text[]),
('AU', 'Australia', 'Australië', array[]::text[]),
('AT', 'Austria', 'Oostenrijk', array['Austrië']::text[]),
('AZ', 'Azerbaijan', 'Azerbeidzjan', array[]::text[]),
('BS', 'Bahamas', 'Bahama’s', array[]::text[]),
('BH', 'Bahrain', 'Bahrein', array[]::text[]),
('BD', 'Bangladesh', 'Bangladesh', array[]::text[]),
('BB', 'Barbados', 'Barbados', array[]::text[]),
('BY', 'Belarus', 'Belarus', array[]::text[]),
('BE', 'Belgium', 'België', array['Belgie']::text[]),
('BZ', 'Belize', 'Belize', array[]::text[]),
('BJ', 'Benin', 'Benin', array[]::text[]),
('BM', 'Bermuda', 'Bermuda', array[]::text[]),
('BT', 'Bhutan', 'Bhutan', array[]::text[]),
('BO', 'Bolivia', 'Bolivia', array['Bolivië']::text[]),
('BA', 'Bosnia and Herzegovina', 'Bosnië en Herzegovina', array['Bosnia & Herzegovina']::text[]),
('BW', 'Botswana', 'Botswana', array[]::text[]),
('BV', 'Bouvet Island', 'Bouveteiland', array[]::text[]),
('BR', 'Brazil', 'Brazilië', array[]::text[]),
('IO', 'British Indian Ocean Territory', 'Brits Indische Oceaanterritorium', array[]::text[]),
('VG', 'British Virgin Islands', 'Britse Maagdeneilanden', array[]::text[]),
('BN', 'Brunei', 'Brunei', array[]::text[]),
('BG', 'Bulgaria', 'Bulgarije', array['Bulgarië']::text[]),
('BF', 'Burkina Faso', 'Burkina Faso', array[]::text[]),
('BI', 'Burundi', 'Burundi', array[]::text[]),
('KH', 'Cambodia', 'Cambodja', array['Cambodië']::text[]),
('CM', 'Cameroon', 'Kameroen', array[]::text[]),
('CA', 'Canada', 'Canada', array[]::text[]),
('CV', 'Cape Verde', 'Kaapverdië', array['Cabo Verde']::text[]),
('BQ', 'Caribbean Netherlands', 'Caribisch Nederland', array[]::text[]),
('KY', 'Cayman Islands', 'Kaaimaneilanden', array[]::text[]),
('CF', 'Central African Republic', 'Centraal-Afrikaanse Republiek', array[]::text[]),
('TD', 'Chad', 'Tsjaad', array[]::text[]),
('CL', 'Chile', 'Chili', array[]::text[]),
('CN', 'China', 'China', array['PRC', 'People''s Republic of China', 'Mainland China']::text[]),
('CX', 'Christmas Island', 'Christmaseiland', array[]::text[]),
('CC', 'Cocos (Keeling) Islands', 'Cocoseilanden', array[]::text[]),
('CO', 'Colombia', 'Colombia', array['Colombië']::text[]),
('KM', 'Comoros', 'Comoren', array[]::text[]),
('CG', 'Congo', 'Congo-Brazzaville', array['Congo - Brazzaville']::text[]),
('CD', 'Congo (DRC)', 'Congo-Kinshasa', array['Congo - Kinshasa']::text[]),
('CK', 'Cook Islands', 'Cookeilanden', array[]::text[]),
('CR', 'Costa Rica', 'Costa Rica', array[]::text[]),
('HR', 'Croatia', 'Kroatië', array['Croatië']::text[]),
('CU', 'Cuba', 'Cuba', array[]::text[]),
('CW', 'Curaçao', 'Curaçao', array[]::text[]),
('CY', 'Cyprus', 'Cyprus', array[]::text[]),
('CZ', 'Czechia', 'Tsjechië', array['Czech Republic', 'Czechië']::text[]),
('CI', 'Côte d''Ivoire', 'Ivoorkust', array['Ivory Coast', 'Cote d''Ivoire', 'Côte d’Ivoire']::text[]),
('DK', 'Denmark', 'Denemarken', array[]::text[]),
('DJ', 'Djibouti', 'Djibouti', array[]::text[]),
('DM', 'Dominica', 'Dominica', array[]::text[]),
('DO', 'Dominican Republic', 'Dominicaanse Republiek', array[]::text[]),
('EC', 'Ecuador', 'Ecuador', array[]::text[]),
('EG', 'Egypt', 'Egypte', array[]::text[]),
('SV', 'El Salvador', 'El Salvador', array[]::text[]),
('GQ', 'Equatorial Guinea', 'Equatoriaal-Guinea', array[]::text[]),
('ER', 'Eritrea', 'Eritrea', array[]::text[]),
('EE', 'Estonia', 'Estland', array['Estonië']::text[]),
('SZ', 'Eswatini', 'Eswatini', array['Swaziland']::text[]),
('ET', 'Ethiopia', 'Ethiopië', array[]::text[]),
('FK', 'Falkland Islands', 'Falklandeilanden', array[]::text[]),
('FO', 'Faroe Islands', 'Faeröer', array[]::text[]),
('FJ', 'Fiji', 'Fiji', array[]::text[]),
('FI', 'Finland', 'Finland', array[]::text[]),
('FR', 'France', 'Frankrijk', array[]::text[]),
('GF', 'French Guiana', 'Frans-Guyana', array[]::text[]),
('PF', 'French Polynesia', 'Frans-Polynesië', array['French Polynesië']::text[]),
('TF', 'French Southern Territories', 'Franse Gebieden in de zuidelijke Indische Oceaan', array[]::text[]),
('GA', 'Gabon', 'Gabon', array[]::text[]),
('GM', 'Gambia', 'Gambia', array['Gambië']::text[]),
('GE', 'Georgia', 'Georgië', array[]::text[]),
('DE', 'Germany', 'Duitsland', array['Deutschland']::text[]),
('GH', 'Ghana', 'Ghana', array[]::text[]),
('GI', 'Gibraltar', 'Gibraltar', array[]::text[]),
('GR', 'Greece', 'Griekenland', array[]::text[]),
('GL', 'Greenland', 'Groenland', array[]::text[]),
('GD', 'Grenada', 'Grenada', array[]::text[]),
('GP', 'Guadeloupe', 'Guadeloupe', array[]::text[]),
('GU', 'Guam', 'Guam', array[]::text[]),
('GT', 'Guatemala', 'Guatemala', array[]::text[]),
('GG', 'Guernsey', 'Guernsey', array[]::text[]),
('GN', 'Guinea', 'Guinee', array[]::text[]),
('GW', 'Guinea-Bissau', 'Guinee-Bissau', array[]::text[]),
('GY', 'Guyana', 'Guyana', array[]::text[]),
('HT', 'Haiti', 'Haïti', array[]::text[]),
('HM', 'Heard and McDonald Islands', 'Heard en McDonaldeilanden', array['Heard & McDonald Islands']::text[]),
('HN', 'Honduras', 'Honduras', array[]::text[]),
('HK', 'Hong Kong', 'Hongkong SAR van China', array['Hong Kong SAR China']::text[]),
('HU', 'Hungary', 'Hongarije', array[]::text[]),
('IS', 'Iceland', 'IJsland', array[]::text[]),
('IN', 'India', 'India', array['Indië']::text[]),
('ID', 'Indonesia', 'Indonesië', array[]::text[]),
('IR', 'Iran', 'Iran', array['Islamic Republic of Iran']::text[]),
('IQ', 'Iraq', 'Irak', array[]::text[]),
('IE', 'Ireland', 'Ierland', array[]::text[]),
('IM', 'Isle of Man', 'Isle of Man', array[]::text[]),
('IL', 'Israel', 'Israël', array[]::text[]),
('IT', 'Italy', 'Italië', array['Italia']::text[]),
('JM', 'Jamaica', 'Jamaica', array[]::text[]),
('JP', 'Japan', 'Japan', array[]::text[]),
('JE', 'Jersey', 'Jersey', array[]::text[]),
('JO', 'Jordan', 'Jordanië', array[]::text[]),
('KZ', 'Kazakhstan', 'Kazachstan', array[]::text[]),
('KE', 'Kenya', 'Kenia', array[]::text[]),
('KI', 'Kiribati', 'Kiribati', array[]::text[]),
('XK', 'Kosovo', 'Kosovo', array[]::text[]),
('KW', 'Kuwait', 'Koeweit', array[]::text[]),
('KG', 'Kyrgyzstan', 'Kirgizië', array[]::text[]),
('LA', 'Laos', 'Laos', array['Lao PDR']::text[]),
('LV', 'Latvia', 'Letland', array['Latvië']::text[]),
('LB', 'Lebanon', 'Libanon', array[]::text[]),
('LS', 'Lesotho', 'Lesotho', array[]::text[]),
('LR', 'Liberia', 'Liberia', array['Liberië']::text[]),
('LY', 'Libya', 'Libië', array[]::text[]),
('LI', 'Liechtenstein', 'Liechtenstein', array[]::text[]),
('LT', 'Lithuania', 'Litouwen', array['Lithuanië']::text[]),
('LU', 'Luxembourg', 'Luxemburg', array[]::text[]),
('MO', 'Macao', 'Macau SAR van China', array['Macao SAR China']::text[]),
('MG', 'Madagascar', 'Madagaskar', array[]::text[]),
('MW', 'Malawi', 'Malawi', array[]::text[]),
('MY', 'Malaysia', 'Maleisië', array['Malaysië']::text[]),
('MV', 'Maldives', 'Maldiven', array[]::text[]),
('ML', 'Mali', 'Mali', array[]::text[]),
('MT', 'Malta', 'Malta', array[]::text[]),
('MH', 'Marshall Islands', 'Marshalleilanden', array[]::text[]),
('MQ', 'Martinique', 'Martinique', array[]::text[]),
('MR', 'Mauritania', 'Mauritanië', array[]::text[]),
('MU', 'Mauritius', 'Mauritius', array[]::text[]),
('YT', 'Mayotte', 'Mayotte', array[]::text[]),
('MX', 'Mexico', 'Mexico', array[]::text[]),
('FM', 'Micronesia', 'Micronesia', array['Micronesië']::text[]),
('MD', 'Moldova', 'Moldavië', array[]::text[]),
('MC', 'Monaco', 'Monaco', array[]::text[]),
('MN', 'Mongolia', 'Mongolië', array[]::text[]),
('ME', 'Montenegro', 'Montenegro', array[]::text[]),
('MS', 'Montserrat', 'Montserrat', array[]::text[]),
('MA', 'Morocco', 'Marokko', array[]::text[]),
('MZ', 'Mozambique', 'Mozambique', array[]::text[]),
('MM', 'Myanmar', 'Myanmar (Birma)', array['Burma', 'Myanmar (Burma)']::text[]),
('NA', 'Namibia', 'Namibië', array[]::text[]),
('NR', 'Nauru', 'Nauru', array[]::text[]),
('NP', 'Nepal', 'Nepal', array[]::text[]),
('NL', 'Netherlands', 'Nederland', array['Holland', 'The Netherlands', 'NLD']::text[]),
('NC', 'New Caledonia', 'Nieuw-Caledonië', array['New Caledonië']::text[]),
('NZ', 'New Zealand', 'Nieuw-Zeeland', array[]::text[]),
('NI', 'Nicaragua', 'Nicaragua', array[]::text[]),
('NE', 'Niger', 'Niger', array[]::text[]),
('NG', 'Nigeria', 'Nigeria', array['Nigerië']::text[]),
('NU', 'Niue', 'Niue', array[]::text[]),
('NF', 'Norfolk Island', 'Norfolk', array[]::text[]),
('KP', 'North Korea', 'Noord-Korea', array[]::text[]),
('MK', 'North Macedonia', 'Noord-Macedonië', array['Macedonia', 'North Macedonië']::text[]),
('MP', 'Northern Mariana Islands', 'Noordelijke Marianen', array[]::text[]),
('NO', 'Norway', 'Noorwegen', array[]::text[]),
('OM', 'Oman', 'Oman', array[]::text[]),
('PK', 'Pakistan', 'Pakistan', array[]::text[]),
('PW', 'Palau', 'Palau', array[]::text[]),
('PS', 'Palestine', 'Palestijnse gebieden', array['Palestinian Territories']::text[]),
('PA', 'Panama', 'Panama', array[]::text[]),
('PG', 'Papua New Guinea', 'Papoea-Nieuw-Guinea', array[]::text[]),
('PY', 'Paraguay', 'Paraguay', array[]::text[]),
('PE', 'Peru', 'Peru', array[]::text[]),
('PH', 'Philippines', 'Filipijnen', array[]::text[]),
('PN', 'Pitcairn Islands', 'Pitcairneilanden', array[]::text[]),
('PL', 'Poland', 'Polen', array[]::text[]),
('PT', 'Portugal', 'Portugal', array[]::text[]),
('PR', 'Puerto Rico', 'Puerto Rico', array[]::text[]),
('QA', 'Qatar', 'Qatar', array[]::text[]),
('RO', 'Romania', 'Roemenië', array['Romanië']::text[]),
('RU', 'Russia', 'Rusland', array['Russian Federation', 'Russië']::text[]),
('RW', 'Rwanda', 'Rwanda', array[]::text[]),
('RE', 'Réunion', 'Réunion', array[]::text[]),
('BL', 'Saint Barthélemy', 'Saint-Barthélemy', array['St. Barthélemy']::text[]),
('SH', 'Saint Helena', 'Sint-Helena', array['St. Helena']::text[]),
('KN', 'Saint Kitts and Nevis', 'Saint Kitts en Nevis', array['St. Kitts & Nevis']::text[]),
('LC', 'Saint Lucia', 'Saint Lucia', array['St. Lucia', 'Saint Lucië']::text[]),
('MF', 'Saint Martin', 'Saint-Martin', array['St. Martin']::text[]),
('PM', 'Saint Pierre and Miquelon', 'Saint-Pierre en Miquelon', array['St. Pierre & Miquelon']::text[]),
('VC', 'Saint Vincent and Grenadines', 'Saint Vincent en de Grenadines', array['St. Vincent & Grenadines']::text[]),
('WS', 'Samoa', 'Samoa', array[]::text[]),
('SM', 'San Marino', 'San Marino', array[]::text[]),
('SA', 'Saudi Arabia', 'Saoedi-Arabië', array['Saudi Arabië']::text[]),
('SN', 'Senegal', 'Senegal', array[]::text[]),
('RS', 'Serbia', 'Servië', array['Serbië']::text[]),
('SC', 'Seychelles', 'Seychellen', array[]::text[]),
('SL', 'Sierra Leone', 'Sierra Leone', array[]::text[]),
('SG', 'Singapore', 'Singapore', array[]::text[]),
('SX', 'Sint Maarten', 'Sint-Maarten', array[]::text[]),
('SK', 'Slovakia', 'Slowakije', array['Slovakië']::text[]),
('SI', 'Slovenia', 'Slovenië', array[]::text[]),
('SB', 'Solomon Islands', 'Salomonseilanden', array[]::text[]),
('SO', 'Somalia', 'Somalië', array[]::text[]),
('ZA', 'South Africa', 'Zuid-Afrika', array[]::text[]),
('GS', 'South Georgia and South Sandwich Islands', 'Zuid-Georgia en Zuidelijke Sandwicheilanden', array['South Georgia & South Sandwich Islands']::text[]),
('KR', 'South Korea', 'Zuid-Korea', array['Korea', 'Republic of Korea']::text[]),
('SS', 'South Sudan', 'Zuid-Soedan', array[]::text[]),
('ES', 'Spain', 'Spanje', array['Espana']::text[]),
('LK', 'Sri Lanka', 'Sri Lanka', array[]::text[]),
('SD', 'Sudan', 'Soedan', array[]::text[]),
('SR', 'Suriname', 'Suriname', array[]::text[]),
('SJ', 'Svalbard and Jan Mayen', 'Spitsbergen en Jan Mayen', array['Svalbard & Jan Mayen']::text[]),
('SE', 'Sweden', 'Zweden', array[]::text[]),
('CH', 'Switzerland', 'Zwitserland', array[]::text[]),
('SY', 'Syria', 'Syrië', array['Syrian Arab Republic']::text[]),
('ST', 'São Tomé and Príncipe', 'Sao Tomé en Principe', array['São Tomé & Príncipe']::text[]),
('TW', 'Taiwan', 'Taiwan', array['Republic of China']::text[]),
('TJ', 'Tajikistan', 'Tadzjikistan', array[]::text[]),
('TZ', 'Tanzania', 'Tanzania', array['Tanzanië']::text[]),
('TH', 'Thailand', 'Thailand', array[]::text[]),
('TL', 'Timor-Leste', 'Oost-Timor', array[]::text[]),
('TG', 'Togo', 'Togo', array[]::text[]),
('TK', 'Tokelau', 'Tokelau', array[]::text[]),
('TO', 'Tonga', 'Tonga', array[]::text[]),
('TT', 'Trinidad and Tobago', 'Trinidad en Tobago', array['Trinidad & Tobago']::text[]),
('TN', 'Tunisia', 'Tunesië', array['Tunisië']::text[]),
('TM', 'Turkmenistan', 'Turkmenistan', array[]::text[]),
('TC', 'Turks and Caicos Islands', 'Turks- en Caicoseilanden', array['Turks & Caicos Islands']::text[]),
('TV', 'Tuvalu', 'Tuvalu', array[]::text[]),
('TR', 'Türkiye', 'Turkije', array['Turkey', 'Turkiye']::text[]),
('UM', 'U.S. Outlying Islands', 'Kleine afgelegen eilanden van de Verenigde Staten', array[]::text[]),
('VI', 'U.S. Virgin Islands', 'Amerikaanse Maagdeneilanden', array[]::text[]),
('UG', 'Uganda', 'Oeganda', array[]::text[]),
('UA', 'Ukraine', 'Oekraïne', array[]::text[]),
('AE', 'United Arab Emirates', 'Verenigde Arabische Emiraten', array['UAE']::text[]),
('GB', 'United Kingdom', 'Verenigd Koninkrijk', array['UK', 'Great Britain', 'England', 'Britain', 'Scotland', 'Wales']::text[]),
('US', 'United States', 'Verenigde Staten', array['USA', 'United States of America', 'America', 'U.S.']::text[]),
('UY', 'Uruguay', 'Uruguay', array[]::text[]),
('UZ', 'Uzbekistan', 'Oezbekistan', array[]::text[]),
('VU', 'Vanuatu', 'Vanuatu', array[]::text[]),
('VA', 'Vatican City', 'Vaticaanstad', array['Holy See']::text[]),
('VE', 'Venezuela', 'Venezuela', array[]::text[]),
('VN', 'Vietnam', 'Vietnam', array['Viet Nam']::text[]),
('WF', 'Wallis and Futuna', 'Wallis en Futuna', array['Wallis & Futuna']::text[]),
('EH', 'Western Sahara', 'Westelijke Sahara', array[]::text[]),
('YE', 'Yemen', 'Jemen', array[]::text[]),
('ZM', 'Zambia', 'Zambia', array['Zambië']::text[]),
('ZW', 'Zimbabwe', 'Zimbabwe', array[]::text[]),
('AX', 'Åland Islands', 'Åland', array[]::text[]);
alter table countries enable row level security;
grant select on countries to authenticated;
create policy read_all on countries for select to authenticated using (true);

-- the stored name for whatever was typed; something unknown stays as it was
create or replace function country_name(p text) returns text language sql stable set search_path = public as $$
  select coalesce((select c.name from countries c
                    where lower(c.name) = lower(trim(p)) or lower(c.name_nl) = lower(trim(p)) or lower(c.code) = lower(trim(p))
                       or exists (select 1 from unnest(c.aliases) a where lower(a) = lower(trim(p)))
                    order by (lower(c.name) = lower(trim(p))) desc limit 1),
                  nullif(trim(p), ''))
$$;

-- ---------- addresses ----------
alter table customers add column street text, add column street2 text, add column postal_code text, add column city text;
alter table suppliers add column street text, add column street2 text, add column postal_code text, add column city text;

-- an existing address, split once: first line street, middle lines street 2, last line "postal code city"
create or replace function split_address(p text, out street text, out street2 text, out postal_code text, out city text)
language plpgsql immutable as $$
declare l text[] := regexp_split_to_array(trim(p), E'\\s*\\n\\s*'); n int; last text; m text[];
begin
  n := coalesce(array_length(l, 1), 0);
  if n = 0 or trim(coalesce(p, '')) = '' then return; end if;
  street := l[1];
  if n > 2 then street2 := array_to_string(l[2:n - 1], ', '); end if;
  if n > 1 then
    last := l[n];
    m := regexp_match(last, '^([0-9][0-9A-Za-z -]*[0-9A-Za-z]|[0-9]+)\s+([^0-9].*)$');
    if m is null then m := regexp_match(last, '^(.*[^0-9 ])\s+([0-9][0-9A-Za-z -]*)$'); if m is not null then m := array[m[2], m[1]]; end if; end if;
    if m is not null then postal_code := m[1]; city := m[2]; else city := last; end if;
  end if;
end $$;
update customers c set street = a.street, street2 = a.street2, postal_code = a.postal_code, city = a.city
  from (select id, (split_address(address)).* from customers where nullif(trim(address), '') is not null) a where a.id = c.id;
update suppliers s set street = a.street, street2 = a.street2, postal_code = a.postal_code, city = a.city
  from (select id, (split_address(address)).* from suppliers where nullif(trim(address), '') is not null) a where a.id = s.id;

-- a party: country to its stored name, address made from the parts
create or replace function trg_party_location() returns trigger language plpgsql as $$
begin
  new.country := country_name(new.country);
  if coalesce(new.street, new.street2, new.postal_code, new.city) is not null then
    new.address := nullif(concat_ws(E'\n', nullif(trim(new.street), ''), nullif(trim(new.street2), ''),
                                    nullif(trim(concat_ws(' ', nullif(trim(new.postal_code), ''), nullif(trim(new.city), ''))), '')), '');
  end if;
  return new;
end $$;
create trigger location before insert or update on customers for each row execute function trg_party_location();
create trigger location before insert or update on suppliers for each row execute function trg_party_location();

-- ---------- ports ----------
alter table shipments add column port_loading_country text, add column port_discharge_country text;
update shipments set port_loading_country = country_name(trim(substring(port_loading from '.*,(.*)$'))), port_loading = trim(substring(port_loading from '^(.*),'))
 where port_loading like '%,%';
update shipments set port_discharge_country = country_name(trim(substring(port_discharge from '.*,(.*)$'))), port_discharge = trim(substring(port_discharge from '^(.*),'))
 where port_discharge like '%,%';
create or replace function trg_shipment_location() returns trigger language plpgsql as $$
begin
  new.port_loading_country := country_name(new.port_loading_country);
  new.port_discharge_country := country_name(new.port_discharge_country);
  return new;
end $$;
create trigger location before insert or update on shipments for each row execute function trg_shipment_location();

alter table products add column pol_city text, add column pol_country text;
create or replace function trg_product_location() returns trigger language plpgsql as $$
begin
  new.pol_country := country_name(new.pol_country);
  return new;
end $$;
create trigger location before insert or update of pol_country on products for each row execute function trg_product_location();

-- existing countries to their stored name (only rows that change)
update customers set country = country_name(country) where country is distinct from country_name(country);
update suppliers set country = country_name(country) where country is distinct from country_name(country);

create or replace view v_shipments with (security_invoker = true) as
select s.id, s.forwarder, s.container_number, s.bl_number, s.port_loading, s.port_discharge, s.ready_date, s.etd, s.eta, s.docs_complete, s.notes,
  case when s.eta is not null and s.eta <= app_today() then 'arrived'
       when s.etd is not null and s.etd <= app_today() then 'in_transit'
       when s.etd is not null or s.eta is not null   then 'planned'
       else 'awaiting_info' end as status,
  (select string_agg(o.pi_number, ', ') from shipment_orders x join sales_orders o on o.id = x.sales_order_id where x.shipment_id = s.id) as pi_numbers,
  (select string_agg(po.po_number, ', ') from shipment_orders x join purchase_orders po on po.id = x.purchase_order_id where x.shipment_id = s.id) as po_numbers,
  s.port_loading_country, s.port_discharge_country
from shipments s;

create or replace function draft_document(p_order uuid, p_type text) returns jsonb
language plpgsql stable set search_path = public as $$
declare o record; c record; sh record; n int; base text; result jsonb;
begin
  if p_type not in ('packing_list','delivery_note') then raise exception 'Unknown document type %', p_type; end if;
  select * into o from sales_orders where id = p_order;
  if not found then raise exception 'Order not found'; end if;
  select * into c from customers where id = o.customer_id;
  select s.* into sh from shipment_orders so join shipments s on s.id = so.shipment_id where so.sales_order_id = p_order limit 1;
  base := case p_type when 'packing_list' then 'PL-' else 'DN-' end || coalesce(o.pi_number, 'draft-' || left(o.id::text, 8));
  select count(*) into n from generated_documents where doc_type = p_type and doc_number like base || '%';
  select jsonb_build_object(
    'doc_type', p_type,
    'doc_number', base || case when n > 0 then '-' || (n + 1) else '' end,
    'doc_date', app_today(),
    'shipment_id', sh.id,
    'header', jsonb_build_object(
      'shipper', concat_ws(E'\n', nullif((select value from app_settings where key = 'company_name'), ''), nullif((select value from app_settings where key = 'company_address'), '')),
      'consignee', concat_ws(E'\n', c.name, nullif(c.address, ''), c.country),
      'deliver_to', concat_ws(E'\n', c.name, nullif(c.address, ''), c.country),
      'pi_number', o.pi_number, 'customer_po', o.customer_po, 'terms', o.order_type,
      'forwarder', sh.forwarder, 'container_number', sh.container_number, 'seal_number', null, 'bl_number', sh.bl_number,
      'port_loading', nullif(concat_ws(', ', sh.port_loading, sh.port_loading_country), ''), 'port_discharge', nullif(concat_ws(', ', sh.port_discharge, sh.port_discharge_country), ''), 'etd', sh.etd, 'eta', sh.eta,
      'shipping_marks', null, 'notes', null),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product_id', p.id, 'description', p.name, 'sku', p.sku, 'qty', l.quantity - l.quantity_cancelled,
               'units_per_carton', p.units_per_carton, 'net_kg_carton', p.carton_net_kg, 'gross_kg_carton', p.carton_weight_kg,
               'length_cm', p.carton_length_cm, 'width_cm', p.carton_width_cm, 'height_cm', p.carton_height_cm,
               'cartons', null, 'net_kg', null, 'gross_kg', null, 'cbm', null, 'remarks', null) order by l.line_no)
        from sales_order_lines l join products p on p.id = l.product_id
       where l.sales_order_id = p_order and l.quantity - l.quantity_cancelled > 0), '[]'))
  into result;
  return result;
end $$;
