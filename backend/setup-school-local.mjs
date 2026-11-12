import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import dotenv from 'dotenv';
import pg from 'pg';
import {fileURLToPath} from 'node:url';

dotenv.config({path:fileURLToPath(new URL('./.env.school.local',import.meta.url))});
const connectionString=String(process.env.SCHOOL_DEV_DATABASE_URL||'').trim();
const email=String(process.env.SCHOOL_LOCAL_ADMIN_EMAIL||'schooladmin@local.test').trim().toLowerCase();
const password=String(process.env.SCHOOL_LOCAL_ADMIN_PASSWORD||'');
const schoolName=String(process.env.SCHOOL_LOCAL_COMPANY_NAME||'Masar Local Demo School').trim();
let database;
try{database=new URL(connectionString)}catch{
  console.error('Set a valid local SCHOOL_DEV_DATABASE_URL in backend/.env.school.local.');
  process.exit(2);
}
if(!['localhost','127.0.0.1','::1'].includes(database.hostname)||database.port!=='15433'){
  console.error('School Bus local setup only accepts the isolated local database on port 15433.');
  process.exit(2);
}
if(!email.includes('@')||password.length<12||!schoolName){
  console.error('Set SCHOOL_LOCAL_ADMIN_EMAIL, a 12+ character SCHOOL_LOCAL_ADMIN_PASSWORD, and SCHOOL_LOCAL_COMPANY_NAME.');
  process.exit(2);
}

const here=fileURLToPath(new URL('.',import.meta.url));
const migration=spawnSync(process.execPath,['migrate-school.js'],{
  cwd:here,
  env:{...process.env,SCHOOL_MIGRATION_DATABASE_URL:connectionString},
  stdio:'inherit'
});
if(migration.error)throw migration.error;
if(migration.status!==0)process.exit(migration.status||1);

const {Pool}=pg;
const pool=new Pool({connectionString,max:1,connectionTimeoutMillis:5000,application_name:'masar-school-local-seed'});
const hashPassword=(value,salt=crypto.randomBytes(16).toString('hex'))=>`${salt}:${crypto.scryptSync(String(value),salt,64).toString('hex')}`;
let client;
try{
  client=await pool.connect();
  await client.query('BEGIN');
  const company=(await client.query(`INSERT INTO companies(name,email,status,metadata)
    VALUES($1,$2,'active',$3::jsonb)
    ON CONFLICT(name) DO UPDATE SET email=EXCLUDED.email,status='active',metadata=EXCLUDED.metadata,updated_at=NOW()
    RETURNING id`,[schoolName,email,JSON.stringify({localDemo:true})])).rows[0];
  const admin=(await client.query(`INSERT INTO auth_users(company_id,name,email,password_hash,role,status,metadata)
    VALUES($1,'Local School Admin',$2,$3,'school_admin','active',$4::jsonb)
    ON CONFLICT(email) DO UPDATE SET company_id=EXCLUDED.company_id,name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,
      role='school_admin',status='active',metadata=EXCLUDED.metadata,updated_at=NOW()
    RETURNING id`,[company.id,email,hashPassword(password),JSON.stringify({schoolAdmin:true,localDemo:true})])).rows[0];
  await client.query(`INSERT INTO school_accounts(company_id,display_name,status,admin_user_id,metadata)
    VALUES($1,$2,'active',$3,$4::jsonb)
    ON CONFLICT(company_id) DO UPDATE SET display_name=EXCLUDED.display_name,status='active',admin_user_id=EXCLUDED.admin_user_id,
      metadata=EXCLUDED.metadata,updated_at=NOW()`,[company.id,schoolName,admin.id,JSON.stringify({localDemo:true})]);
  await client.query('COMMIT');
  console.info(`Local School Bus sign-in ready: ${email}`);
}catch(error){
  if(client)try{await client.query('ROLLBACK')}catch{}
  console.error(`Could not prepare local School Bus sign-in: ${error.message}`);
  process.exitCode=1;
}finally{
  client?.release();
  await pool.end();
}
