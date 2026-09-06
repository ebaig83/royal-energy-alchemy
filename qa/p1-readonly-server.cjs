// Local review only. Never deploy this service-role development server.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {FIELDS,readTable,project}=require('../netlify/functions/lib/p1-read-model');
function createServer({root,base,key,port=4390,handler}){
 const origin='http://127.0.0.1:'+port;
 return http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  const end=(status,body)=>{res.writeHead(status);res.end(body);};
  if(req.headers.host!=='127.0.0.1:'+port||(req.headers.origin&&req.headers.origin!==origin)||req.headers['sec-fetch-site']==='cross-site')return end(403,'Local same-origin access only');

  const u=new URL(req.url,origin);
  if(u.pathname==='/.netlify/functions/verify-pin'&&req.method==='POST'){
   let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)return end(413,'Too large');}
   try{const upstream=await fetch('https://www.daronroyal.com/.netlify/functions/verify-pin',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://www.daronroyal.com'},body});const cookie=upstream.headers.get('set-cookie');if(cookie)res.setHeader('Set-Cookie',cookie);res.setHeader('Content-Type','application/json');return end(upstream.status,await upstream.text());}catch{return end(503,'Sign-in unavailable');}
  }
  if(req.method!=='GET')return end(405,'Read-only review');
  if(u.pathname==='/.netlify/functions/p1-read-model'||u.pathname==='/api/p1/read-model'){
   if(!handler)return end(401,'Authentication required');
   const result=await handler({httpMethod:'GET',headers:req.headers,queryStringParameters:Object.fromEntries(u.searchParams)});for(const [k,v] of Object.entries(result.headers||{}))res.setHeader(k,v);return end(result.statusCode,result.body);
  }
  if(!/^\/dashboard-p1(?:\.html|\/[a-z-]+\.(?:mjs|css))$/.test(u.pathname))return end(404,'Not found');
  try{const file=path.join(root,u.pathname);res.setHeader('Content-Type',u.pathname.endsWith('.html')?'text/html; charset=utf-8':u.pathname.endsWith('.css')?'text/css':'text/javascript');return end(200,fs.readFileSync(file));}catch{return end(404,'Not found');}
 });
}
if(require.main===module){
 const root=process.env.P1_ROOT||path.resolve(__dirname,'..'),env={};
 for(const line of fs.readFileSync(process.env.P1_ENV_FILE||path.join(root,'qa','.env'),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim().replace(/^['"]|['"]$/g,'');}
 if(!env.QA_SUPABASE_URL||!env.QA_SUPABASE_SERVICE_ROLE_KEY)throw Error('Server-side Supabase credentials are unavailable');
 process.env.SUPABASE_URL=env.QA_SUPABASE_URL;process.env.SUPABASE_SERVICE_ROLE_KEY=env.QA_SUPABASE_SERVICE_ROLE_KEY;process.env.P1_LOCAL_REVIEW='true';
 const {handler}=require('../netlify/functions/p1-read-model');
 createServer({root,handler}).listen(4390,'127.0.0.1',()=>console.log('Read-only local review: http://127.0.0.1:4390/dashboard-p1.html'));
}
module.exports={FIELDS,readTable,project,createServer};
