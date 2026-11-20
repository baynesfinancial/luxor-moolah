import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins/magic-link';

export async function seedAdmin(env, db) {
  const email = env.BOOTSTRAP_EMAIL?.trim().toLowerCase();
  if (email) await db.run("INSERT OR IGNORE INTO users(id,email,role) SELECT ?,?,'manager' WHERE NOT EXISTS(SELECT 1 FROM users WHERE role='manager')",crypto.randomUUID(),email);
}
async function sendEmail(env, origin, email, link) {
  if (env.DEV_EMAIL_LOG === 'true' && ['localhost','127.0.0.1'].includes(new URL(origin).hostname)) {
    console.log(`Local staff sign-in for ${email}: ${link}`);
    return;
  }
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) throw new Error('Staff email is not configured.');
  const result = await fetch('https://api.resend.com/emails',{
    method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({
      from:env.MAIL_FROM,to:[email], subject:'Your Luxor Moolah staff access',
      text:`Use this one-time link to open the Luxor Moolah staff workspace. It expires in 30 minutes.\n\n${link}`
    })
  });
  if (!result.ok) throw new Error('Staff email delivery failed.');
}
export function buildAuth(env, db, origin) {
  const baseURL = env.APP_ORIGIN || origin;
  return betterAuth({
    baseURL, basePath:'/api/auth', secret:env.BETTER_AUTH_SECRET, database:env.DB,
    rateLimit:{enabled:true,storage:'database'},
    session:{expiresIn:60*60*12,disableSessionRefresh:true},
    databaseHooks:{ user:{ create:{ before: async user => {
      const allowed = await db.one('SELECT id FROM users WHERE email=? AND active=1',user.email.toLowerCase());
      return Boolean(allowed);
    }}}},
    plugins:[magicLink({
      expiresIn:1800,storeToken:'hashed',
      sendMagicLink:async ({email,url}) => {
        if (await db.one('SELECT id FROM users WHERE email=? AND active=1',email.toLowerCase())) {
          await sendEmail(env,baseURL,email,url);
        }
      }
    })]
  });
}
export async function staffSession(request, auth, db) {
  if (!request.headers.get('Cookie')) return null;
  const current = await auth.api.getSession({headers:request.headers});
  if (!current) return null;
  return db.one('SELECT id,email,role FROM users WHERE email=? AND active=1',current.user.email.toLowerCase());
}
