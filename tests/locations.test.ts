import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, one } from './db.ts';

test('locations: one stored name per country; address from its parts; ports split in city and country', async () => {
  const db = await freshDb();
  assert.equal((await one<any>(db, `select count(*)::int as n from countries`)).n, 250);
  for (const [typed, want] of [['Croatië', 'Croatia'], ['USA', 'United States'], ['nl', 'Netherlands'], ['Holland', 'Netherlands'], ['united kingdom', 'United Kingdom'], ['Atlantis', 'Atlantis']])
    assert.equal((await one<any>(db, `select country_name($1) as c`, [typed])).c, want);

  const c = await one<any>(db, `insert into customers (name, country, street, street2, postal_code, city) values ('Teleclub', 'Roemenië', 'str. Gheorghieni 15-17', 'et. 4', '050875', 'Bucuresti') returning country, address`);
  assert.deepEqual([c.country, c.address], ['Romania', 'str. Gheorghieni 15-17\net. 4\n050875 Bucuresti']);

  const a = await one<any>(db, `select * from split_address($1)`, ['str. Gheorghieni 15-17\net. 4, ap. 20, Sector 5\n050875 Bucuresti']);
  assert.deepEqual([a.street, a.street2, a.postal_code, a.city], ['str. Gheorghieni 15-17', 'et. 4, ap. 20, Sector 5', '050875', 'Bucuresti']);
  const b = await one<any>(db, `select * from split_address($1)`, ['Keizersgracht 1\n1015 CJ Amsterdam']);
  assert.deepEqual([b.street, b.postal_code, b.city], ['Keizersgracht 1', '1015 CJ', 'Amsterdam']);

  const s = await one<any>(db, `insert into shipments (port_loading, port_loading_country, port_discharge, port_discharge_country) values ('Ningbo', 'china', 'Gdansk', 'Polen') returning port_loading_country, port_discharge_country`);
  assert.deepEqual([s.port_loading_country, s.port_discharge_country], ['China', 'Poland']);
  const p = await one<any>(db, `insert into products (name, pol_city, pol_country) values ('X', 'Xiamen', 'CN') returning pol_country`);
  assert.equal(p.pol_country, 'China');
});

test('locations: clearing all address fields clears the address', async () => {
  const db = await freshDb();
  const id = (await one<any>(db, `insert into customers (name, street, city) values ('A', 'Main 1', 'Town') returning id`)).id;
  await db.query(`update customers set street = null, city = null where id = $1`, [id]);
  assert.equal((await one<any>(db, `select address from customers where id = $1`, [id])).address, null);
});
