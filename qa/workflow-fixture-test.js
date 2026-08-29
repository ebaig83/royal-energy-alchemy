'use strict';
const assert=require('assert');
const f=require('./workflow-fixture');
const m={schemaVersion:1,runId:'workflow-test',marker:'[QA][workflow-test]',qaClientId:'qa-id',lifecycleState:'ready',client:{id:'qa-id',name:'[QA][workflow-test] Disposable'}};
assert.strictEqual(f.validateManifest(m),m);
assert.deepStrictEqual(f.cleanupPlan({...m,records:[{type:'session',id:'s'},{type:'recommendation',id:'r'}]}).map(x=>x.type),['recommendation','session']);
assert.throws(()=>f.validateManifest({schemaVersion:1,runId:'x',qaClientId:'r',marker:'[QA][x]',client:{id:'r',name:'Real'}}));
assert.throws(()=>f.cleanupPlan({...m,records:[{type:'unknown',id:'x'}]}));
console.log('workflow fixture lifecycle tests: 4/4 passed');
