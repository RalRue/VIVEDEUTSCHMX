const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
(async()=>{
 const {readingScores,VERSION,KEYS}=await import('../api/_placement.mjs');
 const ctx=vm.createContext({});vm.runInContext(fs.readFileSync(__dirname+'/../consulta/nivel/questions.js','utf8'),ctx);
 const run=code=>JSON.parse(JSON.stringify(vm.runInContext(code,ctx)));
 assert.deepEqual(readingScores([],VERSION).map(x=>x.correct),[0,0,0]);
 assert.deepEqual(readingScores(KEYS[VERSION],VERSION).map(x=>x.correct),[4,4,4]);
 assert.equal(run('placement.reduce((n,p)=>n+p.questions.length,0)'),12);
 assert.equal(run('writingTasks.length'),3);
 assert.equal(run('typeof scorePlacement'),'undefined','Browser cannot reveal answer keys');
 assert.equal(run('placement.every(p=>p.questions.every(q=>q[1].length===3&&typeof q[2]==="string"))'),true);
 for(const [b,block] of KEYS[VERSION].entries())for(const [i,key] of block.entries())assert(key>=0&&key<run('placement['+b+'].questions['+i+'][1].length'));
 console.log('PLACEMENT PASS: private server keys, all-correct/empty, twelve unchanged choices and three writing options, no public scorer');
})().catch(e=>{console.error(e);process.exitCode=1;});
