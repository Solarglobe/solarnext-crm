const s = `const pg=require('pg');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
pool.query("select id::text from organizations order by created_at asc nulls last limit 1").then(r=>{console.log(r.rows[0].id);return pool.end();});`;
console.log(Buffer.from(s).toString("base64"));
