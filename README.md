# Luxor Moolah

One Cloudflare Workers project for the public catalog, employee workspace, and manager dashboard. Production hostname: **store.quincybaines.com**. The catalog starts empty until the manager adds inventory. The sample CSV contains a demonstration row.

## Run locally

Node 24 is used for the development tools and tests.

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev
```

Open the local URL printed by Wrangler. Choose **Staff workspace**, enter the bootstrap email from `.dev.vars`, and use the one-time link printed by the local dev server. Under **Team**, invite an employee by email and use a separate browser or private window to test as that employee. Local email links are printed only when enabled on a loopback hostname.

```bash
npm run check
```

## GitHub and Cloudflare deployment

1. Create a GitHub repository and push the source directory to it. Keep the repository private if you want source access restricted to the team. Never commit `.dev.vars`, API keys, or account secrets.
2. In Cloudflare, create a D1 database named `luxor-moolah` and an R2 bucket named `luxor-moolah-photos`. Replace the production placeholder database UUID in `wrangler.jsonc` with the real D1 UUID. Enable R2 in the account if needed.
3. Create a separate D1 database and R2 bucket for the `staging` environment and replace its placeholder UUID. Give developers access to the staging deployment and test data. Deploy staging with `npx wrangler deploy --env staging` after applying its migrations with `npx wrangler d1 migrations apply DB --env staging --remote`. For testing sign-in, set its own email and credentials. Staging keeps the customer WhatsApp number blank.
4. In a Cloudflare session with access to the production project, set the Worker secrets below. Add `--env staging` when setting staging secrets.

   | Setting | What to enter |
   | --- | --- |
   | `BETTER_AUTH_SECRET` | A unique random secret of at least 32 characters for each environment. |
   | `BOOTSTRAP_EMAIL` | The email of the first and only production administrator. The initial staff sign-in request seeds this account. Changing the variable later does not create another administrator. |
   | `RESEND_API_KEY` | Email provider key for invitations and one-time sign-in links. |
   | `MAIL_FROM` | A verified sender for the Resend account. |
   | `STAFF_WHATSAPP` | Optional manager WhatsApp number, with country code. Employee item links use this number. |
   | `APP_ORIGIN` | Optional fixed origin for email links, such as `https://store.quincybaines.com`. Set when its hostname is reachable. |

   Example command for each secret:

   ```bash
   npx wrangler secret put BETTER_AUTH_SECRET
   ```

5. Apply production migrations with `npm run db:remote`. Connect the GitHub repo to the Cloudflare Worker for builds, using `npx wrangler deploy` as the deploy command, or deploy manually from the checked-out repo with `npm run deploy`. Apply migrations before deploying later code that depends on a new schema.
6. Test with a staging catalog first. Verify production email delivery using the administrator address, then import or enter opening inventory. Check the sales flow, published prices, and WhatsApp number from a phone.
7. Make sure `quincybaines.com` is in the Cloudflare account as an active zone. Uncomment the Custom Domain route in `wrangler.jsonc` and deploy again, or attach the hostname to the production Worker in Cloudflare. If the production origin was fixed to a preview hostname, update it to the custom domain.

## Access and inventory workflow

- Public visitors can browse published products and start a WhatsApp conversation.
- Staff sign-in uses one-time Better Auth email links. Authorization is checked against the app's staff list on every protected request. The sign-in form is available publicly for invited staff. The manager grants or revokes staff access under **Team**. No public account registration is exposed.
- The app holds one inventory count. A pending sale reserves units. Approval records the sale and reduces stock. Canceling a pending sale releases the hold. Managers record corrections to approved sales as returns.
- The **CSV upload** tab provides a template. Match each product row to a list of image filenames separated by a vertical bar, then select the CSV and photos together. The manager reviews drafts before publishing. Existing SKUs require an explicit selection to update the listing or receive stock.
- The **Stock closeout** on the manager dashboard uses dated stock movements and the selected date range. Historical figures require verified opening counts and the dated movements covering the period.
- The configured defaults are GYD and America/Guyana. Confirm both before entering live data. Prices are stored as minor units and displayed in the configured currency.

### Reference

[Cloudflare Worker configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) · [Better Auth magic links](https://better-auth.com/docs/plugins/magic-link)
