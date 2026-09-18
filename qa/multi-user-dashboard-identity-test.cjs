const fs = require('fs');
const app = fs.readFileSync('dashboard-p1/app.mjs', 'utf8');
const readModel = fs.readFileSync('netlify/functions/p1-read-model.js', 'utf8');

if (!app.includes('function authenticatedDisplayName()')) throw new Error('dashboard does not derive the authenticated display name');
if (!app.includes('`Good morning, ${authenticatedDisplayName()}`')) throw new Error('today greeting is not user-specific');
if (!readModel.includes('data.user=auth.user')) throw new Error('read model does not expose the authenticated identity');
if (app.includes("key==='today'?'Good morning, Daron'")) throw new Error('hardcoded Daron greeting remains');

console.log('PASS multi-user dashboard greeting uses the authenticated display name');
