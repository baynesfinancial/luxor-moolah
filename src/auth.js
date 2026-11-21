import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins/magic-link';
import { passkey } from '@better-auth/passkey';

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
export function buildAuth(env, db, origin, enablePasskeys = false) {
  const baseURL = env.APP_ORIGIN || origin;
  const passkeyURL = new URL(baseURL);
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
    }), ...(enablePasskeys ? [passkey({
      rpID:passkeyURL.hostname, rpName:'Luxor', origin:passkeyURL.origin,
      authenticatorSelection:{residentKey:'required',userVerification:'required'},
      registration:{requireSession:true}
    })] : [])]
  });
}

const passkeyRoutes = new Map([
  ['generate-authenticate-options','GET'], ['verify-authentication','POST'],
  ['generate-register-options','GET'], ['verify-registration','POST'],
  ['list-user-passkeys','GET'], ['delete-passkey','POST']
]);

export async function handlePasskeyRequest(request,auth,db,env,url) {
  const action=url.pathname.slice('/api/auth/passkey/'.length);
  if (passkeyRoutes.get(action)!==request.method) return Response.json({error:'Page not found.'},{status:404});
  const respond=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
  if (env.APP_ORIGIN && new URL(env.APP_ORIGIN).origin!==url.origin) {
    return respond({error:'Open the primary Luxor website to use passkeys.'},400);
  }
  const signingIn=['generate-authenticate-options','verify-authentication'].includes(action);
  if (!signingIn && !await staffSession(request,auth,db)) {
    return respond({error:'Sign in to manage your passkeys.'},401);
  }
  const exists=await db.one("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='passkey'");
  if (!exists) {
    if (action==='list-user-passkeys') return respond([]);
    if (action!=='generate-register-options') return respond({error:'No passkey is available. Sign in with your password or an email link.'},400);
    // Provision the optional table on first enrollment so an existing store can deploy without a separate migration.
    await db.batch([
      db.sql(`CREATE TABLE IF NOT EXISTS passkey (
        id TEXT PRIMARY KEY, name TEXT, publicKey TEXT NOT NULL,
        userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        credentialID TEXT NOT NULL UNIQUE, counter INTEGER NOT NULL,
        deviceType TEXT NOT NULL, backedUp INTEGER NOT NULL, transports TEXT, createdAt TEXT, aaguid TEXT
      )`),
      db.sql('CREATE INDEX IF NOT EXISTS passkey_user ON passkey(userId)')
    ]);
  }
  const result=await buildAuth(env,db,url.origin,true).handler(request);
  const headers=new Headers(result.headers);
  headers.set('Cache-Control','no-store');
  return new Response(result.body,{status:result.status,headers});
}

export async function staffSession(request, auth, db) {
  if (!request.headers.get('Cookie')) return null;
  const current = await auth.api.getSession({headers:request.headers});
  if (!current) return null;
  return db.one('SELECT id,email,role FROM users WHERE email=? AND active=1',current.user.email.toLowerCase());
}
