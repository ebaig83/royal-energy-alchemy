'use strict';
const TIMEZONE = 'America/New_York';
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' });
function parts(value) { return Object.fromEntries(formatter.formatToParts(value).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)])); }
function wallMillis(p) { return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second); }
// Reject nonexistent spring-forward and ambiguous fall-back wall times rather
// than silently shifting a client appointment. Normal business hours are unique.
function easternInstant(date,time) {
 if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !/^\d{2}:\d{2}(?::\d{2})?$/.test(String(time))) return null;
 const [year,month,day]=date.split('-').map(Number),[hour,minute,second=0]=time.split(':').map(Number);
 if(year<1000||month<1||month>12||day<1||day>31||hour>23||minute>59||second>59)return null;
 const wall=Date.UTC(year,month-1,day,hour,minute,second),check=new Date(wall);
 if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==day)return null;
 const candidates=new Set();
 for(const hours of [-36,-12,0,12,36]) {
  const probe=wall+hours*3600000,offset=wallMillis(parts(new Date(probe)))-probe;
  const candidate=wall-offset;
  if(wallMillis(parts(new Date(candidate)))===wall)candidates.add(candidate);
 }
 return candidates.size===1?new Date([...candidates][0]):null;
}
module.exports={TIMEZONE,easternInstant};
