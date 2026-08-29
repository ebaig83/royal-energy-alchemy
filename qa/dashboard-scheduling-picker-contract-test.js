const fs = require('fs');
const html = fs.readFileSync('dashboard.html','utf8');
const checks = [
  ['visual calendar picker', /dashSchedulePicker/],
  ['clickable day buttons', /dashPickerSelectDate/],
  ['clickable standard time chips', /dashPickerSelectTime/],
  ['other time input', /dashPickerOtherTime/],
  ['occupied sessions filtered', /dashPickerSessions\(\)/],
  ['no start-time select in add form', !/<select[^>]+id="apptTime"/.test(html)],
  ['existing save path retained', /async function saveAppt\(\)/],
  ['public horizon code untouched', /scheduling-horizon/.test(fs.readFileSync('netlify/functions/availability.js','utf8'))]
];
let failed=0; checks.forEach(([name, ok])=>{const pass=ok instanceof RegExp?ok.test(html):ok; console.log(`${pass?'PASS':'FAIL'} ${name}`); if(!pass)failed++;});
if(failed) process.exit(1); console.log(`${checks.length}/${checks.length} passed`);
