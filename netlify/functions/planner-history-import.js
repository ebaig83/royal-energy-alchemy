const { getClient } = require('./lib/supabase');

const IMPORT_TOKEN = 'rea-jj-2026-a91f7c42e58b';
const records = [
  ['2026-06-17','15:00','Cyndi Powers','Energy Session','$70 paid noted in planner.'],
  ['2026-06-17','17:00','Linda Francis','Energy Session — Round 2','$70 paid noted in planner.'],
  ['2026-06-18','19:00','Angel Johnston','Energy Session — Round 3','$70 paid noted in planner.'],
  ['2026-06-19','11:00','Tina Makris','Energy Session — Round 2','$70 noted; payment status unclear.'],
  ['2026-06-19','19:00','Patricia Savoy','Energy Session','WhatsApp / intentions note. $70 noted; payment status unclear.'],
  ['2026-06-25','18:00','Joanne Dawson','Energy Session','$80 noted; payment status unclear.'],
  ['2026-06-30','14:00','Marcella Albany','Energy Session','$70 noted; payment status unclear.'],
  ['2026-06-30','16:00','Maria Luz','Energy Session — Round 2','$70 paid noted in planner.'],
  ['2026-07-01','16:00','Pat Hughes','Energy Session','$80 paid noted in planner.'],
  ['2026-07-02','14:00','April Smith','Energy Session — Round 2','$70 noted; payment status unclear.'],
  ['2026-07-02','16:00','Anna Berry','Energy Session','$80 paid noted in planner.'],
  ['2026-07-16','08:00','Sue Ramsey','Energy Session','Payment unclear.'],
  ['2026-07-16','14:00','Cyndi Powers','Energy Session — Round 2','Payment unclear.'],
  ['2026-07-16','16:00','Diamond Odyssey','Energy Session','Payment unclear.'],
  ['2026-07-16','18:00','Mirella','Energy Session — Round 3','Payment unclear.'],
  ['2026-07-17','12:00','Sheri Epling','Energy Session','Payment unclear.'],
  ['2026-07-17','18:00','Suzette Pergande','Energy Session','Payment unclear.'],
  ['2026-07-20','10:00','Rose Pierce','Energy Session — Round 3','$70 noted; payment status unclear.'],
  ['2026-07-22','14:00','Joanne Rose','Energy Session — Round 2','Payment unclear.'],
  ['2026-07-22','16:00','Susan Snyder','Energy Session — Round 2','In-person appointment. Payment unclear.'],
  ['2026-07-23','18:00','Kathy Blair','Energy Session — Round 3','Payment unclear.'],
  ['2026-07-27','12:00','Michael W Collins','Energy Session','$80 noted; payment status unclear.'],
  ['2026-07-27','16:00','Annette Dunwoody','Energy Session','$70 noted; payment status unclear.'],
  ['2026-07-28','08:00','Patrick Mahon','Energy Session','Payment unclear.'],
  ['2026-07-29','10:00','Rachelle Walker (UK)','Energy Session','Payment unclear.'],
  ['2026-07-29','18:00','Kelly Sullivan','Energy Session','Payment unclear.'],
  ['2026-07-31','14:00','Linda Edwards','Energy Session — Round 3','Payment unclear.'],
  ['2026-07-31','16:00','Brittany Keller','Energy Session','Payment unclear.'],
  ['2026-07-31','18:00','Angel Tharp','Energy Session','Payment unclear.']
];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  if ((event.headers['x-import-token'] || '') !== IMPORT_TOKEN) return { statusCode: 401, body: 'Unauthorized' };
  const sb = getClient();
  const added = [], skipped = [];
  for (const [date,time,name,service,note] of records) {
    const { data: existing, error: readError } = await sb.from('sessions').select('id').eq('session_date',date).eq('session_time',time).ilike('client_name',name).maybeSingle();
    if (readError) return { statusCode: 500, body: JSON.stringify({ error: readError.message, added, skipped }) };
    if (existing) { skipped.push(`${date} ${time} ${name}`); continue; }
    const { error } = await sb.from('sessions').insert({client_name:name,service,session_date:date,session_time:time,duration_minutes:60,status:'confirmed',payment_status:'unpaid',source:'planner-reconciliation',seller_notes:`Planner-confirmed historical appointment. ${note}`});
    if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message, added, skipped }) };
    added.push(`${date} ${time} ${name}`);
  }
  return { statusCode: 200, headers:{'Content-Type':'application/json'}, body: JSON.stringify({added,skipped}) };
};
