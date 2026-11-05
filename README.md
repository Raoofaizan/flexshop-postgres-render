# FlexShop Manager — Online, Single-Admin PostgreSQL Edition

This project converts the supplied **FlexShop Manager** HTML interface into an Express/Node.js web app with **one secure administrator**, a **relational PostgreSQL database**, and a free-tier **Render + Neon** deployment configuration. Your invoicing, customers, inventory, job orders, expenses, staff loans/advances and reports are retained.

> **Status:** Deployment files and application code provided. JavaScript syntax and local unit tests can be checked with `npm run check` / `npm test`. A real Render/Neon deployment and end-to-end browser/database test require your own accounts and a valid `DATABASE_URL`; they cannot be performed automatically from this ZIP.

## 1. Required accounts

- [GitHub](https://github.com/) — holds the private project source code.
- [Neon](https://neon.com/) — PostgreSQL database. Free plan subject to usage limits.
- [Render](https://render.com/) — Node.js web hosting. Free web service sleeps after 15 minutes without requests.

**Why external Postgres?** Render's free web service has an **ephemeral filesystem**; local SQLite database changes disappear on restarts/redeployments. Render's *free PostgreSQL offering* also has a **30-day expiry**. This project instead connects Render to an external Neon PostgreSQL database.

## 2. Deploy to the internet (Render + Neon)

1. Extract this ZIP; keep `.env` and exported customer JSON backups **out of GitHub**.
2. Create a **private** GitHub repository and upload/commit the extracted project files (including `render.yaml`, `package.json`, `server.js`, `db/`, `public/`). Do **not** commit `node_modules` or any `.env` file.
3. Go to [Neon Console](https://console.neon.tech), create a free PostgreSQL project and a database (for example `flexshop`). Open **Connect** and copy the Postgres connection URL. It looks like:
   `postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require`
   The connection URL is a **secret**, and should never be posted in public or added to source files.
4. On [Render Dashboard](https://dashboard.render.com), use **New → Blueprint**, connect your GitHub repository and apply the `render.yaml` blueprint. Select **Free** for the web service if prompted.
5. In the Render service's **Environment** settings, set these three variables to actual values:

   | Key | Value |
   | --- | --- |
   | `DATABASE_URL` | **Entire Neon connection URL** from step 3 (include SSL parameters) |
   | `ADMIN_EMAIL` | Your private admin email address |
   | `ADMIN_PASSWORD` | A unique, strong password of **12+ characters** |

   `NODE_ENV=production` is already in `render.yaml`. **Never put actual secrets into `render.yaml` or GitHub.**
6. Deploy the service. Node runs `db/migrations/001_initial.sql` automatically at startup and creates the **first admin account** if none exists. No manual SQL import is required.
7. Open the Render URL, usually `https://your-service-name.onrender.com/login.html`, and sign in using the admin email/password. You can change the password under **Settings**. Keep the Render URL private unless you need someone to reach the sign-in page.
8. Once you can sign in, **remove `ADMIN_PASSWORD` from the Render environment and redeploy**. The admin password is already securely hashed in PostgreSQL, so removing this bootstrap secret does not delete or reset the account. Do not remove `DATABASE_URL`.
9. **Settings → Download Backup**: save a private JSON backup after significant changes. Schedule a regular backup process yourself if production use is planned; this project does not automatically back up the Neon database.

### 2A. Manual Render setup (if not using Blueprint)

Create a **Web Service** from your GitHub repository with runtime **Node**, plan **Free**, build command `npm install --omit=dev`, start command `npm start`, and health-check `/api/health`. Set the three environment variables above. Render supplies its own `PORT` and HTTPS URL automatically.

## 3. Run locally with PostgreSQL (for testing)

Install **Node.js 22.13+** and obtain a PostgreSQL connection URL (a Neon URL works locally too).

```bash
# From the extracted project folder
cp .env.example .env
# Edit .env: DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD
npm install
npm run check
npm test
npm start
```

Windows PowerShell: use `Copy-Item .env.example .env` instead of `cp` if you prefer.

Open `http://localhost:3000/login.html`.

**Note:** This project needs a real PostgreSQL connection even when run on your laptop. It is not an offline SQLite version.

## 4. Move your previous data (optional but important)

There are *two different old versions*. Pick whichever you actually used. Import is one-time and **only into an empty business database**.

**A. Original stand-alone HTML file (`localStorage`, `fps_` keys)**

1. Open the old HTML file in the **same browser and origin** where you entered data; verify its existing customers and invoices are visible.
2. Follow `tools/EXPORT_OLD_DATA.txt` to export those `fps_` browser records to `flexshop-browser-export.json`.
3. Sign into the online app → **Settings → One-Time Import** → select JSON → import.

**B. Previously supplied Node.js + SQLite local server (`flexshop.sqlite`)**

1. Make a **copy** of your old server's `data/flexshop.sqlite` file first.
2. With Node.js 22+, from *this new project folder* run:

```bash
node tools/export-sqlite.js "/path/to/old/flexshop-local/data/flexshop.sqlite"
```

3. This creates `flexshop-sqlite-export.json` in your current directory. Upload this in **Settings → One-Time Import**.

**Neither export tool changes or deletes old records.** The import preserves the stock quantity stored in the old system (it does **not** subtract saved invoices a second time). Every import runs inside one SQL transaction and rolls back if a record is invalid. If the old app has already deleted an item/customer still referenced by an invoice, the import will report the problem rather than silently lose invoices.

**Security:** Backup JSON contains business/customer data. Store it in a private location; do not upload it to GitHub.

## 5. Included features

- Single administrator login and hashed password (scrypt); server-side PostgreSQL sessions with `HttpOnly`, `SameSite=Lax`, and production HTTPS-only cookies.
- Login attempt rate limit, same-origin mutation checks, escaped user-generated HTML, basic security headers.
- Customers, full customer ledger, separate payments, invoice printouts.
- Inventory types: flex rolls, ink, other; add and restock; stock protection on invoice saves.
- Invoice create, edit, delete in SQL transactions with correct stock restoration on changes/deletions. Adding a *draft* line does not change stock.
- Job orders, expenses, staff salaries, advances, loans and repayments; existing reports.
- Readable PostgreSQL tables: `admins`, `sessions`, `customers`, `inventory`, `invoices`, `invoice_items`, `payments`, `jobs`, `expenses`, `staff`, `staff_ledger`.
- Settings: change password, manual JSON backup, one-time legacy import.

### Important accounting notes

- **Invoices display “Paid at Billing”**; separate customer payments are shown in the **Customer Ledger** and included in overall Outstanding Dues / Amount Collected. They are not allocated to an individual invoice because the original system did not record invoice associations on separate customer payments.
- The original “Profit” and “Estimated Net Profit” reports are simplified calculations and **should not be treated as certified accounting or tax reports**. The estimated net result does not replace full cost-of-goods and payroll accounting.
- Purchase rates are snapshotted into each invoice line; editing an invoice uses the *current* material purchase rate for newly re-saved lines.
- Single-admin is **not** a role-based multi-user system. If staff must have independent access later, add separate accounts/permissions and an audit log.

## 6. Maintenance / backups

- Use **Settings → Download Backup** after significant updates and before importing/redeploying.
- For full relational database backups, use `pg_dump` against Neon PostgreSQL (backup URL must remain secret). Periodically test restores in a separate database.
- When you change database schema in the future, create a *new numbered SQL file* in `db/migrations/`, not by editing the already applied migration.
- Keep Node dependencies updated and redeploy after security fixes. The repository has no `package-lock.json` because package downloads are not available in this creation environment; **run `npm install` on your computer and commit the generated `package-lock.json`** for reproducible subsequent deploys.
- When updating to `npm ci`, first ensure `package-lock.json` is present in your repository.

### Free plan caveats

Render explicitly says free instances are for testing/hobby previews and not production-grade uptime. Free apps suspend after 15 minutes idle and may take ~1 minute to wake. Neon free storage and compute have monthly caps and plan changes are possible. Financial/customer records require careful backups and stronger uptime for serious business operations.

---

**Project structure**

```text
flexshop-postgres-render/
  render.yaml
  .env.example
  .gitignore
  package.json
  server.js
  db/
    database.js
    validation.js
    migrate.js
    migrations/001_initial.sql
  public/
    index.html, app.js, styles.css
    login.html, login.js, login.css
  tools/
    EXPORT_OLD_DATA.txt
    export-sqlite.js
  tests/
    ...
```
