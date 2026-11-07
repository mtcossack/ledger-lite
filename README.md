# Ledger Lite

A simple, mobile-friendly, private **shared household ledger** for two adults. The app supports separate email/password logins, multiple people, money balances, points, screen-time minutes, transaction history, renaming people, and CSV export. No calendar, TV dashboard, children's accounts, third-party analytics, or sample family data.

**Each family deploys its own copy.** Every copy runs on a separate Cloudflare Worker with its own Cloudflare D1 database. Publishing the source code never publishes ledger data, assuming you do not add credentials or personal exports to your repository.

## What you need

- A Cloudflare account with Workers and D1 enabled (check its current pricing and limits).
- Node.js 22.13+ and npm installed on your computer.
- A terminal (PowerShell, Terminal, etc.) and optionally a new GitHub repository.
- Two adult email addresses and strong passwords.

## Deploy your own private ledger

Run these commands in the **Ledger Lite project folder**:

1. Install dependencies: `npm install`
2. Log into your own Cloudflare account: `npx wrangler login`
3. Create your own database: `npx wrangler d1 create ledger-lite-db`
4. Open `wrangler.jsonc` and ensure its `d1_databases` field contains the following, with **your own** ID from step 3 (if Wrangler already added a binding, edit it rather than adding another):

   ```json
   "d1_databases": [
     {"binding":"DB","database_name":"ledger-lite-db","database_id":"YOUR_DATABASE_ID"}
   ]
   ```

   Make sure the binding is exactly `DB`, and do **not** reuse someone else's database ID.
5. Create the database tables: `npm run db:remote`
6. Create an adult user: `npm run user:add`. Enter a display name, email address, and a strong password. The password will **not echo** in the terminal. The script creates an ignored local file `.local/add-user.sql` containing only a salted password hash.
7. Apply that user to your database: `npx wrangler d1 execute ledger-lite-db --remote --file=./.local/add-user.sql`
8. Repeat steps 6 and 7 for the other adult. The second account gets the same ledger data, but a separate login.
9. Deploy the app: `npm run deploy`. Wrangler prints your new `https://...workers.dev` URL.
10. Both adults can sign in using their own email/password. Bookmark the website or add it to your home screen.

You are done. For a local test, run `npm run db:local` followed by `npm run user:add` and the **local** user-add command that the script prints. Then run `npm run dev`. Local and remote databases are **different**.

**Updating a password:** repeat `npm run user:add` for the existing email and execute the generated SQL. This updates its password hash and revokes its existing login sessions.

## Sharing this code

Publish **this new Ledger Lite folder**, not a fork of any private family application's repository. If you create a public GitHub repository, create an **empty** repository and upload only the files from this folder, or use `git init` and commit these clean files. Do not carry over unrelated Git history.

Safe-to-share source files are included. Never commit `.local/`, `.dev.vars`, `.env`, `.wrangler/`, password exports, a populated database, deployment access tokens, or any real family data. These paths are gitignored, but check `git status` before publishing. Don't remove the `.gitignore`.

You can share a GitHub link with friends. Each friend should clone/download the code, create **their own Cloudflare account, Worker, D1 database and users**, and follow the setup above.

## Features and design choices

- **Separate adults, one household:** every authenticated account sees and can edit the same people and entries in that instance. There is no cross-family tenant sharing in one database. This is intentional.
- **No public registration:** accounts must be created via the local setup command. There are no public sign-up or password-reset endpoints.
- **Private-by-default API:** session cookie authentication is checked server-side for reading data, editing it, and exporting CSV. Both API and database are inaccessible to visitors without a valid session, assuming Cloudflare is configured normally.
- **Password handling:** passwords are hashed with PBKDF2-HMAC-SHA256, random per-user salts and 600,000 iterations. Sessions use random bearer tokens; only their SHA-256 hashes are stored in D1. Cookies use Secure, HttpOnly, and SameSite=Strict, expire in 14 days, and mutations require a same-origin request. Login attempts are throttled.
- **Append-only transaction history:** you can't silently edit past transactions. For a mistake, add the opposite adjustment with a reason. You can rename people without losing history.
- **Money is in USD**, stored as integer cents. Points are integer units; screen time is integer minutes. The code can be adapted to another currency.
- **Backup:** click Export CSV periodically. The export includes *all* transactions, not just those currently displayed (the on-screen history shows the newest 300 across the household). Retain your CSV securely.
- **No email is sent:** there is no automatic password recovery. A person with access to the Cloudflare database and deployment can create or reset users with the setup script.

## Security notes

This is a small self-hosted starter, **not a formally audited authentication product**. It is meant for ordinary household balances, **not bank credentials, medical records, financial-account access or other high-risk sensitive information**. Run updates and review access periodically. Cloudflare's edge, D1, and TLS are part of the security boundary; the GitHub repository only holds application code.

Keep the Worker deployment on HTTPS (the default `workers.dev` address supports it), and configure Cloudflare account two-factor authentication. If you put the site behind a custom proxy, retest same-origin requests and the authentication flow.

If you prefer not to maintain password-based login, Cloudflare Access can be configured outside this app, but this starter uses passwords as requested. Access itself is not required for this starter's application-level session checks.

## Tests

Run `npm test` for source safety checks and `npm run typecheck` for Worker TypeScript verification. Run `npm run dev` and test in a browser with your own local database.

## License

MIT. This implementation was written as a clean standalone starter and does not include proprietary or private application source code.
