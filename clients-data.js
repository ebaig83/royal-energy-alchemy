// ============================================================
// Royal Energy Alchemy — Session & Client Data
// Daron Royal · Erie PA · royalenergyalchemy@gmail.com
// ============================================================
// Structure: each session entry is one booked slot.
// price: number (USD) — 0 for exchange/unknown/TBD
// round: session number with this client (1 = first time)
// tags: descriptive flags (inPerson, distance, tarot, exchange, reschedule, package, deposit)
// ============================================================

const REA_DATA = {

  sessions: [

    // ── WEEK OF JUNE 8 ──────────────────────────────────────
    { date:'2026-06-08', client:'Maureen',                    price:0,   round:null, tags:['reschedule'],  notes:'Reschedule pending — price TBD' },
    { date:'2026-06-08', client:'Hilda',                      price:0,   round:2,    tags:[],              notes:'Round 2 — price not listed' },
    { date:'2026-06-08', client:'Brandon',                    price:0,   round:2,    tags:[],              notes:'Round 2 — price not listed' },
    { date:'2026-06-08', client:'Daniel Vousey',              price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-08', client:'Nancy Brooking',             price:70,  round:1,    tags:['paid'],        notes:'Paid' },
    { date:'2026-06-08', client:'Mirella-Sierra Nevada',      price:70,  round:2,    tags:[],              notes:'' },

    { date:'2026-06-09', client:'Daryl Sobolik',              price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-09', client:'Toril Hodnaland Nottestad',  price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-09', client:'Leah Welch',                 price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-09', client:'Tammy Mattice',              price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-09', client:'Cindy Brown',                price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-09', client:'Carol McClelland',           price:150, round:1,    tags:['paid'],        notes:'Paid' },

    { date:'2026-06-10', client:'SAHEL',                      price:70,  round:2,    tags:[],              notes:'' },
    { date:'2026-06-10', client:'Jared-Kasey Walker',         price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-10', client:'Heather Anderson',           price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-10', client:'Amber Silliman',             price:70,  round:2,    tags:[],              notes:'' },
    { date:'2026-06-10', client:'Maureen Goodman',            price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-10', client:'Melissa Wisdom',             price:70,  round:1,    tags:[],              notes:'' },

    { date:'2026-06-11', client:'Janet Unterkofler',          price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-11', client:'Patricia Kanes',             price:100, round:1,    tags:[],              notes:'' },
    { date:'2026-06-11', client:'Cheryl Varner',              price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-11', client:'Valorie Strickland',         price:70,  round:2,    tags:[],              notes:'' },
    { date:'2026-06-11', client:'Kelly',                      price:0,   round:1,    tags:['exchange'],    notes:'Exchange — no charge' },

    { date:'2026-06-12', client:'Taylore McManne',            price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-12', client:'Myrtha Rodriguez',           price:140, round:2,    tags:[],              notes:'' },
    { date:'2026-06-12', client:'Marjo Gunnison',             price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-12', client:"Sunethro's Sister",          price:65,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-12', client:'Tracy Silva',                price:100, round:1,    tags:[],              notes:'' },

    // Sat 6/13 Marionville Bigfoot Fun — no sessions
    // Sun 6/14 Rest — no sessions

    // ── WEEK OF JUNE 15 ─────────────────────────────────────
    { date:'2026-06-15', client:'Jeanne Elpel',               price:80,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-15', client:'Carol Albertson',            price:70,  round:4,    tags:[],              notes:'' },
    { date:'2026-06-15', client:'Erika Oakley Crempa',        price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-15', client:'Gary',                       price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-15', client:'Dranie Ware',                price:70,  round:2,    tags:[],              notes:'' },

    { date:'2026-06-16', client:'Mama Friesen',               price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-16', client:"Farson's Daughter",          price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-16', client:'Kimberly Bonus',             price:70,  round:2,    tags:[],              notes:'' },
    { date:'2026-06-16', client:'Angela Marshall',            price:70,  round:2,    tags:[],              notes:'' },
    { date:'2026-06-16', client:"Sunethra's Brother",         price:65,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-16', client:"Lori's Granddaughter",       price:70,  round:1,    tags:[],              notes:'' },

    { date:'2026-06-17', client:'Jackie',                     price:80,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-17', client:'Peng-Sealten Penny',         price:80,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-17', client:'Cyndi Powers',               price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-17', client:'Linda French',               price:70,  round:2,    tags:[],              notes:'' },
    { date:'2026-06-17', client:'Shauna Hensley',             price:90,  round:1,    tags:[],              notes:'' },

    { date:'2026-06-18', client:'Dr. Agnello',                price:0,   round:1,    tags:[],              notes:'Price not listed' },
    { date:'2026-06-18', client:'Isdory',                     price:80,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-18', client:'Wanda Huff',                 price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-18', client:'Anne Collins',               price:70,  round:3,    tags:[],              notes:'' },
    { date:'2026-06-18', client:'Angel Broken',               price:70,  round:3,    tags:[],              notes:'' },

    { date:'2026-06-19', client:'Tina Makris',                price:70,  round:2,    tags:[],              notes:'' },
    { date:'2026-06-19', client:'Linda Edwards',              price:70,  round:2,    tags:[],              notes:'' },
    { date:'2026-06-19', client:'Matshidise Tembe',           price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-19', client:'Michelle Hoclars',           price:80,  round:2,    tags:[],              notes:'' },
    { date:'2026-06-19', client:'Patricia Savoy',             price:70,  round:2,    tags:[],              notes:'' },

    // Sat 6/20 Fun — Sun 6/21 Rest

    // ── WEEK OF JUNE 22 ─────────────────────────────────────
    { date:'2026-06-22', client:'Michele Selzay',             price:70,  round:2,    tags:[],              notes:'' },
    { date:'2026-06-22', client:'David Tharp',                price:80,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-22', client:"Michelle-Susie's Friend",    price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-22', client:'Susan Platinsky',            price:70,  round:2,    tags:[],              notes:'' },
    { date:'2026-06-22', client:'Rand Rice',                  price:80,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-22', client:"Tammy's Mum-Jinka",          price:70,  round:1,    tags:[],              notes:'' },

    { date:'2026-06-23', client:'Lindsey Vigesaa',            price:70,  round:2,    tags:[],              notes:'' },
    { date:'2026-06-23', client:'Arlin Kelly',                price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-23', client:'Anders Hull Sweden',         price:80,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-23', client:'Suzette Pergande',           price:40,  round:2,    tags:[],              notes:'' },
    { date:'2026-06-23', client:'Victoria Whitcross',         price:70,  round:1,    tags:[],              notes:'' },

    { date:'2026-06-24', client:'Isdory Lyamuya',             price:80,  round:2,    tags:[],              notes:'Follow-up to 6/18 session' },
    { date:'2026-06-24', client:'Aneta Nep',                  price:70,  round:2,    tags:[],              notes:'' },
    { date:'2026-06-24', client:'Morgan Illinois',            price:80,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-24', client:'Susan Snyder Connaut',       price:80,  round:1,    tags:['inPerson'],    notes:'In Person' },
    { date:'2026-06-24', client:'Sarah Viral',                price:50,  round:1,    tags:['inPerson'],    notes:'In Person' },

    { date:'2026-06-25', client:'Lisa Russo / Lisa Breckman', price:80,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-25', client:'Kathleen Blair',             price:70,  round:2,    tags:[],              notes:'' },
    { date:'2026-06-25', client:'Jeanette-Steven',            price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-25', client:'Gray Whitlock',              price:80,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-25', client:'Johanne Dawson',             price:80,  round:1,    tags:[],              notes:'' },

    { date:'2026-06-26', client:'Rose Pierce',                price:70,  round:2,    tags:[],              notes:'' },
    { date:'2026-06-26', client:'Dorota',                     price:70,  round:3,    tags:[],              notes:'' },
    { date:'2026-06-26', client:'Andy Padell',                price:70,  round:1,    tags:['reschedule'],  notes:'Reschedule' },
    { date:'2026-06-26', client:'Kathleen Blair Grand Kids',  price:150, round:1,    tags:['package'],     notes:'Grand Kids Package' },
    { date:'2026-06-26', client:"Son + Daughter-in-law",      price:0,   round:1,    tags:[],              notes:'Price not listed' },

    // Sat 6/27 Fun — Sun 6/28 Rest

    // ── WEEK OF JUNE 29 ─────────────────────────────────────
    { date:'2026-06-29', client:'Elaine Jones Brennan',       price:80,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-29', client:'Michelle Garman',            price:80,  round:2,    tags:[],              notes:'' },
    { date:'2026-06-29', client:'Jeanette-Charise Daughter',  price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-29', client:'Holly',                      price:70,  round:2,    tags:[],              notes:'' },
    { date:'2026-06-29', client:'Cindy Cook',                 price:70,  round:2,    tags:[],              notes:'' },

    { date:'2026-06-30', client:'Todora Dobreva',             price:80,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-30', client:'Cindy Belich',               price:80,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-30', client:'Maristella Altung',          price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-06-30', client:'Marc Lord',                  price:70,  round:2,    tags:[],              notes:'' },
    { date:'2026-06-30', client:'Daughter Hillary',           price:60,  round:1,    tags:['tarot'],       notes:'Tarot reading' },

    // ── WEEK OF JULY 1 ──────────────────────────────────────
    { date:'2026-07-01', client:'Olivia Hinsmt Son (Finland)',price:90,  round:2,    tags:[],              notes:'' },
    { date:'2026-07-01', client:'Marc Silva',                 price:80,  round:1,    tags:[],              notes:'' },
    { date:'2026-07-01', client:'Mersella',                   price:60,  round:4,    tags:[],              notes:'' },
    { date:'2026-07-01', client:'Pat Huber',                  price:80,  round:1,    tags:[],              notes:'' },
    { date:'2026-07-01', client:'Kelly Sullivan',             price:70,  round:2,    tags:[],              notes:'' },

    { date:'2026-07-02', client:'Danielle',                   price:70,  round:4,    tags:[],              notes:'' },
    { date:'2026-07-02', client:'Sarah Smielt',               price:70,  round:2,    tags:[],              notes:'' },
    { date:'2026-07-02', client:'Ariel-Sarah',                price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-07-02', client:'Ana Bury',                   price:80,  round:1,    tags:[],              notes:'' },
    { date:'2026-07-02', client:'Tammy Pruitt',               price:80,  round:1,    tags:[],              notes:'' },

    { date:'2026-07-03', client:'Trinity Trimm',              price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-07-03', client:"Ghea (Katie Cahill's Son)",  price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-07-03', client:'Sally Granados',             price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-07-03', client:'Mark Anthony',               price:60,  round:1,    tags:[],              notes:'' },
    { date:'2026-07-03', client:'Tarot Reading',              price:30,  round:1,    tags:['tarot'],       notes:'Tarot reading' },

    { date:'2026-07-04', client:"Kirk's Noon",                price:0,   round:1,    tags:[],              notes:'Price not listed' },

    // ── WEEK OF JULY 6 ──────────────────────────────────────
    { date:'2026-07-06', client:'Jordan-Joanne Rue',          price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-07-06', client:'Erika (You Can See)',        price:80,  round:1,    tags:[],              notes:'' },
    { date:'2026-07-06', client:'Joanne Uzar',                price:80,  round:2,    tags:[],              notes:'' },
    { date:'2026-07-06', client:'Sara Jane Koster Strm',      price:70,  round:2,    tags:[],              notes:'' },
    { date:'2026-07-06', client:"Kellie Kratochvil (Lindsay's Sister)", price:70, round:3, tags:[], notes:'' },

    { date:'2026-07-07', client:'Kelly Sibley',               price:80,  round:1,    tags:[],              notes:'' },
    { date:'2026-07-07', client:'Dawn Yekrahs (Sharkley)',    price:70,  round:3,    tags:[],              notes:'' },
    { date:'2026-07-07', client:'Jayne Taylor',               price:70,  round:2,    tags:[],              notes:'Via WhatsApp' },
    { date:'2026-07-07', client:'Maria Podesta (PR)',         price:70,  round:2,    tags:[],              notes:'' },
    { date:'2026-07-07', client:'Sarah Viral',                price:50,  round:2,    tags:[],              notes:'' },

    { date:'2026-07-08', client:'Dave Cospit (UK)',           price:70,  round:1,    tags:[],              notes:'' },
    { date:'2026-07-08', client:'Marcy Stahl',                price:100, round:1,    tags:[],              notes:'' },
    { date:'2026-07-08', client:'Debra West Mexico',          price:80,  round:1,    tags:[],              notes:'' },
    { date:'2026-07-08', client:'Courtney Brassarte',         price:70,  round:2,    tags:[],              notes:'' },
    { date:'2026-07-08', client:'Jeff',                       price:70,  round:1,    tags:[],              notes:'' },

    { date:'2026-07-09', client:'Karen Hassler Clements',     price:70,  round:2,    tags:[],              notes:'' },
    { date:'2026-07-09', client:'Nancy McKinnes',             price:70,  round:2,    tags:[],              notes:'' },
    { date:'2026-07-09', client:'Amy Waldring',               price:70,  round:1,    tags:[],              notes:'' },

    { date:'2026-07-10', client:'Linda Hill',                 price:70,  round:2,    tags:[],              notes:'' },
    { date:'2026-07-10', client:'Tina Makris',                price:70,  round:3,    tags:[],              notes:'' },
    { date:'2026-07-10', client:'Michelle Hudson',            price:70,  round:3,    tags:[],              notes:'' },
    { date:'2026-07-10', client:"Shawna's B-Day",             price:50,  round:1,    tags:['deposit'],     notes:'Deposit — Katie booking' },
    { date:'2026-07-10', client:'Mary + Katie Fredonia',      price:200, round:1,    tags:['paid','inPerson'], notes:'Paid cash' },

    // ── WEEK OF JULY 13 ─────────────────────────────────────
    { date:'2026-07-13', client:'Victoria Whitcross',         price:70,  round:2,    tags:[],              notes:'' },

    { date:'2026-07-15', client:'Hilda + Brandon',            price:120, round:3,    tags:['package'],     notes:'Combined package' },

  ],

  // ── COMPUTED HELPERS ──────────────────────────────────────
  // Call REA_DATA.compute() after the array is defined.
  computed: null,

  compute() {
    const s = this.sessions;
    const revenue   = s.reduce((t, x) => t + (x.price || 0), 0);
    const sessCount = s.length;
    const paying    = s.filter(x => x.price > 0).length;

    // Unique clients by name (normalised lower-case)
    const nameMap = {};
    s.forEach(x => {
      const key = x.client.toLowerCase().trim();
      if (!nameMap[key]) nameMap[key] = { client: x.client, sessions: [], totalSpend: 0 };
      nameMap[key].sessions.push(x);
      nameMap[key].totalSpend += x.price || 0;
    });
    const clientList = Object.values(nameMap);
    const totalClients = clientList.length;
    const repeatClients = clientList.filter(c => c.sessions.length > 1 || (c.sessions[0] && c.sessions[0].round > 1)).length;
    const repeatRate = Math.round((repeatClients / totalClients) * 100);

    // Revenue by week (Mon–Sun)
    const weekMap = {};
    s.forEach(x => {
      const d = new Date(x.date);
      const day = d.getDay(); // 0=Sun
      const diff = (day === 0) ? -6 : 1 - day;
      const mon = new Date(d); mon.setDate(d.getDate() + diff);
      const wk = mon.toISOString().slice(0,10);
      if (!weekMap[wk]) weekMap[wk] = { week: wk, revenue: 0, sessions: 0 };
      weekMap[wk].revenue   += x.price || 0;
      weekMap[wk].sessions  += 1;
    });
    const weeks = Object.values(weekMap).sort((a,b)=>a.week.localeCompare(b.week));

    const avgPerSession = paying > 0 ? Math.round(revenue / paying) : 0;
    const tarotCount    = s.filter(x => x.tags.includes('tarot')).length;
    const exchangeCount = s.filter(x => x.tags.includes('exchange')).length;
    const inPersonCount = s.filter(x => x.tags.includes('inPerson')).length;

    this.computed = { revenue, sessCount, paying, totalClients, repeatClients,
                      repeatRate, avgPerSession, weeks, clientList,
                      tarotCount, exchangeCount, inPersonCount };
    return this.computed;
  }
};

// Auto-compute on load
REA_DATA.compute();

// ============================================================
// CLIENT FLAGS — blocked / warned clients
// Stored in localStorage under key 'rea_client_flags'
// Each entry: { name, email, status, reasons, notes, date, flaggedBy }
// status: 'blocked' | 'warned'
// ============================================================

const REA_FLAGS = {

  _key: 'rea_client_flags',

  // Load all flags from localStorage
  load() {
    try { return JSON.parse(localStorage.getItem(this._key) || '{}'); }
    catch(e) { return {}; }
  },

  // Save all flags to localStorage
  _save(data) {
    localStorage.setItem(this._key, JSON.stringify(data));
  },

  // Normalise a name or email to a lookup key
  _normalise(str) {
    return (str || '').toLowerCase().replace(/\s+/g,' ').trim();
  },

  // Add or update a flag
  set(name, email, status, reasons, notes) {
    const data = this.load();
    const key  = this._normalise(email || name);
    data[key] = {
      name:      name  || '',
      email:     email || '',
      status,           // 'blocked' | 'warned'
      reasons:   reasons || [],
      notes:     notes   || '',
      date:      new Date().toISOString().slice(0,10),
    };
    this._save(data);
    return data[key];
  },

  // Remove a flag (unblock/unwarn)
  remove(nameOrEmail) {
    const data = this.load();
    const key  = this._normalise(nameOrEmail);
    delete data[key];
    this._save(data);
  },

  // Check a name/email — returns flag entry or null
  check(nameOrEmail) {
    if (!nameOrEmail) return null;
    const data = this.load();
    const key  = this._normalise(nameOrEmail);
    return data[key] || null;
  },

  // Check both name AND email (returns first match found)
  checkBoth(name, email) {
    return this.check(name) || this.check(email) || null;
  },

  // Return all flagged entries as array
  all() {
    const data = this.load();
    return Object.values(data);
  }

};
