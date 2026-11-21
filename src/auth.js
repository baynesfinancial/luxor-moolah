import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins/magic-link';

export async function seedAdmin(env, db) {
  const email = env.BOOTSTRAP_EMAIL?.trim().toLowerCase();
  if (email) await db.run("INSERT OR IGNORE INTO users(id,email,role) SELECT ?,?,'manager' WHERE NOT EXISTS(SELECT 1 FROM users WHERE role='manager')",crypto.randomUUID(),email);
}
async function sendEmail(env, origin, email, link, reset=false) {
  if (env.DEV_EMAIL_LOG === 'true' && ['localhost','127.0.0.1'].includes(new URL(origin).hostname)) {
    console.log(`Local staff ${reset?'password reset':'sign-in'} for ${email}: ${link}`);
    return;
  }
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) throw new Error('Staff email is not configured.');
  const result = await fetch('https://api.resend.com/emails',{
    method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({
      from:env.MAIL_FROM,to:[email], subject:reset?'Reset your Luxor password':'Your Luxor staff access',
      text:`Use this one-time link to ${reset?'reset your Luxor password':'open the Luxor staff workspace'}. It expires in 30 minutes.\n\n${link}`
    })
  });
  if (!result.ok) throw new Error('Staff email delivery failed.');
}
export function buildAuth(env, db, origin) {
  const baseURL = env.APP_ORIGIN || origin;
  const allowedEmail = email => db.one('SELECT id FROM users WHERE email=? AND active=1',email.toLowerCase());
  return betterAuth({
    baseURL, basePath:'/api/auth', secret:env.BETTER_AUTH_SECRET, database:env.DB,
    rateLimit:{enabled:true,storage:'database',customRules:{'/request-password-reset':{window:60,max:5}}},
    session:{expiresIn:60*60*12,disableSessionRefresh:true},
    emailAndPassword:{
      enabled:true,disableSignUp:true,requireEmailVerification:true,
      minPasswordLength:12,maxPasswordLength:128,
      resetPasswordTokenExpiresIn:1800,revokeSessionsOnPasswordReset:true,
      sendResetPassword:async ({user,token})=>{
        if (await allowedEmail(user.email)) {
          const link=new URL('/staff?password=reset',baseURL);
          link.hash=new URLSearchParams({token}).toString();
          await sendEmail(env,baseURL,user.email,link.href,true);
        }
      }
    },
    databaseHooks:{
      user:{create:{before:async user=>Boolean(await allowedEmail(user.email))}},
      session:{create:{
        before:async session=>Boolean(await db.one(`
          SELECT 1 FROM "user" auth_user JOIN users staff ON staff.email=auth_user.email
          WHERE auth_user.id=? AND staff.active=1`,session.userId)),
        after:async session=>{
          if (!session) return;
          try {
            await db.run(`INSERT INTO audit(actor,action,target,created_at)
              SELECT staff.id,'team.first_sign_in',staff.id,
                COALESCE((SELECT MIN(createdAt) FROM "session" WHERE userId=auth_user.id),?)
              FROM "user" auth_user JOIN users staff ON staff.email=auth_user.email
              WHERE auth_user.id=? AND NOT EXISTS(
                SELECT 1 FROM audit WHERE action='team.first_sign_in' AND target=staff.id
              )`,new Date(session.createdAt).toISOString(),session.userId);
          } catch(error) {
            console.error('Could not record first staff sign-in',error.message);
          }
        }
      }},
      // Give concurrent setup or reset attempts the same credential key.
      account:{create:{before:async account=>account.providerId==='credential'
        ? {data:{id:`credential:${account.userId}`}} : undefined}}
    },
    plugins:[magicLink({
      expiresIn:1800,storeToken:'hashed',
      sendMagicLink:async ({email,url}) => {
        if (await allowedEmail(email)) {
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
