import dotenv from 'dotenv';
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';

dotenv.config({path:fileURLToPath(new URL('./.env.school.local',import.meta.url))});
dotenv.config();
const connectionString=String(process.env.SCHOOL_MIGRATION_DATABASE_URL||process.env.SCHOOL_DEV_DATABASE_URL||'').trim();
if(!connectionString){
  console.error('Set SCHOOL_MIGRATION_DATABASE_URL to an isolated development database. DATABASE_URL is deliberately not used.');
  process.exit(2);
}

let parsed;
try{parsed=new URL(connectionString)}catch{
  console.error('SCHOOL_MIGRATION_DATABASE_URL must be a valid PostgreSQL URL.');
  process.exit(2);
}
if(!['localhost','127.0.0.1','::1'].includes(parsed.hostname)||parsed.port==='15432'){
  console.error('Refusing migration: SCHOOL_MIGRATION_DATABASE_URL must point to a local development database, never the shared tunnel or production.');
  process.exit(2);
}

const here=dirname(fileURLToPath(import.meta.url));
const files=['schema.sql','migration-parent-bus.sql','migration-auth-app-roles.sql','migration-school-portal.sql','migration-school-push.sql'];
const {Pool}=pg;
const pool=new Pool({connectionString,max:1,connectionTimeoutMillis:5000,application_name:'masar-school-migration'});
let client;
try{
  client=await pool.connect();
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('masar_school_portal_migrations'))");
  for(const file of files){
    const sql=await readFile(join(here,file),'utf8');
    await client.query(sql);
    console.info(`Applied ${file}`);
  }
  await client.query('COMMIT');
  console.info(`School schema is ready on ${parsed.hostname}:${parsed.port||'5432'}/${decodeURIComponent(parsed.pathname.slice(1))}.`);
}catch(error){
  if(client)try{await client.query('ROLLBACK')}catch{}
  console.error(`School migration failed: ${error.message}`);
  process.exitCode=1;
}finally{
  client?.release();
  await pool.end();
}
