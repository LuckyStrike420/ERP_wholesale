# Moving from the local test database to Supabase

The local test database and Supabase run the same SQL files (`supabase/migrations`) and the screens talk to both through
one small adapter (`web/src/data`). Moving is configuration, not a rebuild.

## What is needed from you

1. A Supabase project (any region in the EU).
2. Its **database connection string** (Project settings > Database > Connection string, Session mode), with the password.
3. Its **project URL** and **anon key** (Project settings > API).
4. One user per person under Authentication > Users (e-mail + password). Start with yourself.

## Steps

```bash
# 1. schema, calculations, audit log, access rules + your admin role
DATABASE_URL="<connection string>" npm run supabase:setup -- --admin you@yourproducts.eu --name "Sander"

# 2. data: dry run first, then save. The save is refused while any figure differs from Excel.
DATABASE_URL="<connection string>" npm run import -- --file data/YP_Order_en_betaalsheetV5.xlsx
DATABASE_URL="<connection string>" npm run import -- --file data/YP_Order_en_betaalsheetV5.xlsx --commit

# 3. point the app at Supabase
cp web/.env.example web/.env      # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
cd web && pnpm build              # dist/ is the site to host (Vercel, Netlify, Supabase hosting, any static host)
```

Further users: create them under Authentication, then set their role in the app under Admin > Users, or with
`insert into profiles (user_id, full_name, role) values ('<auth user id>', 'Name', 'finance');`

## What changes for you

| | Local test database | Supabase |
| --- | --- | --- |
| Where data lives | This browser only | Supabase, shared, backed up |
| Sign-in | None, you are admin | E-mail + password, role per user |
| Access rules | Not enforced | Enforced by the database for every request |
| Import | Admin > Import, in the browser | `npm run import`, in one transaction |
| Later changes to the schema | Applied on next start | `npm run supabase:setup` applies only the new files |

## Not carried over

Data typed into the local test database stays in that browser. Supabase starts from the workbook import, so re-export or
re-enter anything you want to keep, or keep working in Excel until the move.

## Status

Done on 11 Nov 2026 for the Supabase project "wholesale" (eu-central-1), through the Supabase connector:

- Migrations 0001 to 0006 applied and recorded in `app_migrations`, so `npm run supabase:setup` will only apply later ones.
- Workbook data loaded. The figures in the calculation views are identical to the local test database.
- Access rules checked on the live database: finance books payments but cannot edit orders, operations the reverse,
  a signed-in user without a role sees nothing, a visitor who is not signed in is refused.

Still to do: create the first user and give it the admin role, then fill in `web/.env`.
