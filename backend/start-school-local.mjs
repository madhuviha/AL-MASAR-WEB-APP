import dotenv from 'dotenv';
import {fileURLToPath} from 'node:url';

const localEnv=fileURLToPath(new URL('./.env.school.local',import.meta.url));
dotenv.config({path:localEnv});

const connectionString=String(process.env.SCHOOL_DEV_DATABASE_URL||'').trim();
if(!connectionString){
  console.info('School API skipped: add SCHOOL_DEV_DATABASE_URL to backend/.env.school.local to enable a local School API.');
  process.exit(0);
}

let database;
try{database=new URL(connectionString)}catch{
  console.error('School API refused to start: SCHOOL_DEV_DATABASE_URL is not a valid PostgreSQL URL.');
  process.exit(2);
}
if(!['localhost','127.0.0.1','::1'].includes(database.hostname)||database.port==='15432'){
  console.error('School API refused to start: its development database must be local and cannot use the shared tunnel.');
  process.exit(2);
}

process.env.DATABASE_URL=connectionString;
process.env.SCHOOL_API_PORT=process.env.SCHOOL_API_PORT||'3002';
await import('./school-server.js');
