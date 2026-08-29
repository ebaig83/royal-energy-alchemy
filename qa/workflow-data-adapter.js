'use strict';

// Injectable persistence boundary for workflow QA. The default adapter is an
// in-memory fake; production adapters must be explicitly supplied by callers.
class MemoryWorkflowAdapter {
  constructor(seed={}) { this.tables = new Map(Object.entries(seed).map(([k,v])=>[k,new Map(v.map(r=>[r.id,{...r}]))])); this.next=1; }
  _table(t){ if(!this.tables.has(t)) this.tables.set(t,new Map()); return this.tables.get(t); }
  async get(table,id){ const r=this._table(table).get(id); return r ? {...r} : null; }
  async create(table,row){ const id=row.id||`qa-${this.next++}`; const out={...row,id}; this._table(table).set(id,out); return {...out}; }
  async update(table,id,fields){ const old=await this.get(table,id); if(!old) throw new Error(`Missing ${table}:${id}`); const out={...old,...fields}; this._table(table).set(id,out); return {...out}; }
  async remove(table,id){ this._table(table).delete(id); return !(await this.get(table,id)); }
}
function assertSafeBoundary(name){ throw new Error(`QA side-effect blocked: ${name}`); }
module.exports={MemoryWorkflowAdapter,assertSafeBoundary};
