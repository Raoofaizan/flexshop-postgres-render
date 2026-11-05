# FlexShop Manager ko FREE Hosting par Live Karna

**Setup:** Render (website/backend) + Neon (online PostgreSQL database) + GitHub (source code).

## Step-by-step

**1. ZIP extract karein.** `flexshop-postgres-render` folder milega.

**2. GitHub par private repository banayein.** Project ki files upload karein. `.env`, koi password, backup JSON, aur `node_modules` upload **na** karein.

**3. Neon par free PostgreSQL project banayein:** https://console.neon.tech
- New Project -> naam `flexshop`.
- **Connect** par click karke poori database connection string copy karein.
- Example: `postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require`
- Ye string **private password** jaisi cheez hai.

**4. Render par deploy karein:** https://dashboard.render.com
- **New -> Blueprint** select karein; apna GitHub repo connect karein.
- Project ke `render.yaml` se Node app configure ho jayegi.
- Web service ka **Free** plan select karein.

**5. Render ki Environment settings mein 3 values add karein:**

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Neon se copy ki hui poori PostgreSQL URL |
| `ADMIN_EMAIL` | Aapka admin email |
| `ADMIN_PASSWORD` | Apna strong password (kam az kam 12 characters) |

**6. Deploy complete hone par** URL open karein, misaal:
`https://flexshop-manager.onrender.com/login.html`
(Aapka actual URL Render par alag ho sakta hai.)

**7. Admin se login karein.** Tables aur admin account automatic ban jayenge. Settings mein password change kar sakte hain.

**8. Pehli successful login ke baad**, Render Environment se bootstrap `ADMIN_PASSWORD` variable remove kar ke redeploy kar dein. Database mein password ka secure hash pehle se saved hai.

**9. Regular backup:** App mein Settings -> Download Backup (.json) use karein. JSON file private jagah save karein.

## Purana Data Kaise Layein?

- Agar pehli HTML file browser mein chalti thi: `tools/EXPORT_OLD_DATA.txt` follow karke JSON export karein.
- Agar purana Node + SQLite local server use kiya tha: `tools/export-sqlite.js` se JSON export karein. Details `README.md` mein hain.
- New app -> **Settings -> One-Time Import** se JSON import karein. Database khali hona zaroori hai. Import existing data overwrite nahi karta.

## Zaroori Note

- Render free plan 15 minutes inactive rehne par sleep karta hai. Pehla page load kabhi takreeban 1 minute le sakta hai.
- Render ke free server par **SQLite save na karein**; local files restart ke baad delete ho sakti hain. Is project mein Neon PostgreSQL use hota hai.
- Neon free account mein storage aur compute limits hain. Project ko daily important business data ke liye use karne se pehle backup / recovery aur real deployment testing zaroor karein.
- Ye source code aapko diya gaya hai; humne aapke GitHub, Neon ya Render accounts par khud deploy **nahi** kiya.
