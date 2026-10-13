import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acknowledgedUpload, isDeferredUpload } from '../src/features/health/data/health-upload.ts';
import { recordedIntake } from '../src/features/nutrition/data/recorded-intake.ts';
test('future health records remain retryable without blocking valid records',()=>{
  const now=Date.parse('2026-10-13T10:00:00Z');
  const sample=(id:string,end:string)=>({id,start:end,end,value:1,sourceBundleId:'test',sourceName:'Test'});
  const batch={type:'HKQuantityTypeIdentifierStepCount' as const,samples:[sample('valid','2026-10-13T09:00:00Z'),sample('future','2026-10-14T09:00:00Z')],deleted:[]};
  const retry=acknowledgedUpload(batch,{accepted:1,deleted:0,deferred:['future']})!;
  assert.deepEqual(retry.samples.map(row=>row.id),['future']);
  assert.equal(isDeferredUpload(retry,now),true);
  assert.equal(isDeferredUpload(retry,Date.parse('2026-10-14T10:00:00Z')),false);
  assert.throws(()=>acknowledgedUpload(batch,{accepted:2,deleted:0,deferred:['future']}),/confirmed/);
});
test('nutrition uses server remaining calories when saved and a local overlay for pending edits',()=>{
  const input={calories:500,hasLogs:true,pending:false,allSkipped:false,balance:{budgetKcal:2000,remainingKcal:1200}};
  assert.equal(recordedIntake(input).remaining,1200);
  assert.equal(recordedIntake({...input,pending:true}).remaining,1500);
});

