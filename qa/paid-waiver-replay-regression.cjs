'use strict';
const assert = require('node:assert/strict');
const { markBookingState } = require('../netlify/functions/booking-waiver')._test;
const row={id:'qa-booking',source:'online',status:'confirmed',booking_status:'confirmed',payment_status:'paid',waiver_completed:true,waiver_status:'complete',google_calendar_status:'synced',payment_hold_expires_at:null};
const sb={from(){return {select(){return this},eq(){return this},single:async()=>({data:{...row}})}},rpc(){throw new Error('A completed waiver must not mutate a confirmed booking')}};
(async()=>{const result=await markBookingState(sb,row.id,{waiver_completed:true,waiver_status:'complete'});assert.equal(result.alreadyComplete,true);assert.equal(result.data.status,'confirmed');assert.equal(result.data.google_calendar_status,'synced');console.log('PASS paid waiver replay preserves confirmation and calendar without another mutation');})().catch(e=>{console.error(e);process.exitCode=1});
