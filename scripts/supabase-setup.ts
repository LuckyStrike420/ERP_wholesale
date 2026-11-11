/**
 * Prepares a Supabase project for the app. Safe to run again: it only applies what is missing.
 *
 *   DATABASE_URL="postgresql://postgres.<ref>:<password>@<host>:5432/postgres" \
 *   npm run supabase:setup -- --admin you@company.com --name "Your Name"
 *
 * 1. applies every file in supabase/migrations that the database has not seen (tables, calculations, audit, access rules)
 * 2. gives the named user the admin role (the user must already exist under Authentication in Supabase)
 * 3. checks that the calculation views answer, and tells the API to pick up the new schema
 *
 * Data comes next, with the same import that was rehearsed locally:
 *   DATABASE_URL=... npm run import -- --file workbook.xlsx            (dry run)
 *   DATABASE_URL=... npm run import -- --file workbook.xlsx --commit   (save; refused while a figure differs from Excel)
 */
import pg from 'pg';
import { applyMigrations } from '../src/db/migrate.ts';

const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const url = process.env.DATABASE_URL;
if (!url) { console.error('Set DATABASE_URL to the Supabase connection string (Project settings > Database > Connection string, "Session" mode).'); process.exit(1); }

const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  const applied = await applyMigrations(db, m => console.log(' ', m));
  console.log(applied.length ? `${applied.length} migration(s) applied` : 'Database schema is up to date');

  const email = arg('--admin');
  if (email) {
    const u = (await db.query(`select id from auth.users where lower(email) = lower($1)`, [email])).rows[0];
    if (!u) throw new Error(`No user ${email} under Authentication yet. Create the user in Supabase (Authentication > Users > Add user), then run this again.`);
    await db.query(`insert into profiles (user_id, full_name, role) values ($1, $2, 'admin')
                    on conflict (user_id) do update set role = 'admin', full_name = coalesce(excluded.full_name, profiles.full_name)`, [u.id, arg('--name') ?? null]);
    console.log(`${email} is admin`);
  }

  const c = (await db.query(`select (select count(*) from v_orders) as orders, (select count(*) from v_purchase_orders) as pos, (select count(*) from profiles) as users`)).rows[0];
  console.log(`Check: ${c.orders} orders, ${c.pos} purchase orders, ${c.users} user(s) with a role`);
  await db.query(`notify pgrst, 'reload schema'`);
  console.log('\nNext: put the project URL and anon key in web/.env (see web/.env.example), then import the workbook with "npm run import".');
} finally { await db.end(); }
