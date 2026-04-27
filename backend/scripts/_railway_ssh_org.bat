@echo off
cd /d "%~dp0..\.."
railway ssh -- sh -c "cd /app/backend && node --input-type=module -e \"import pg from 'pg'; const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}); const r=await pool.query('select id::text from organizations order by created_at asc nulls last limit 1'); console.log(r.rows[0].id); await pool.end();\""
