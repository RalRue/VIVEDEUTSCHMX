const $=id=>document.getElementById(id);
let step=0,path='test',writingTask=null;
const answers=placement.map(()=>[null,null,null,null]),writing=placement.map(()=>'');
const token=/^#[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(location.hash)?location.hash.slice(1):null;
const submissionId=crypto.randomUUID();
let stored=false,sending=false,attempted=null,blocked=false;
history.replaceState(null,'',location.pathname);
if(token){$('mode').textContent='Freiwilliger Test zu deiner Anfrage. Prüfe alles vor dem Senden.';$('submit-area').hidden=false;}
function hasLanguageEvidence(){return answers.some(a=>a.some(v=>Number.isInteger(v)&&v>=0&&v<3))||writing.some(v=>v.trim());}
function hasUnsavedContent(){return attempted!==null||answers.some(a=>a.some(v=>v!==null))||writing.some(v=>v.length);}
function confirmedProfile(result){
 if(typeof result.test!=='boolean'||!Array.isArray(result.reading)||result.reading.length!==(path==='beginner'?0:3))return false;
 const counts=(p,total)=>p&&p.total===total&&Number.isInteger(p.correct)&&Number.isInteger(p.answered)&&p.correct>=0&&p.correct<=p.answered&&p.answered<=total;
 return result.reading.every((s,b)=>s.block===b+1&&counts(s,4)&&counts(s.reading,2)&&counts(s.grammar,1)&&counts(s.vocabulary,1)&&Number.isInteger(s.wrong)&&s.wrong===s.answered-s.correct&&Number.isInteger(s.unknown)&&s.unknown>=0&&Number.isInteger(s.unanswered)&&s.unanswered>=0&&s.answered+s.unknown+s.unanswered===4);
}
function node(tag,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;}
function render(){
 $('stage').replaceChildren();
 if(step<3){const part=placement[step];$('progress').textContent=`Block ${step+1} von 3 · ${part.title}`;
 $('stage').append(node('p','Lies. Wähle eine Antwort. Du darfst stoppen.'));
 const text=node('p',part.text);text.className='passage';text.lang='de';$('stage').append(text);
 part.questions.forEach((q,i)=>{const field=node('fieldset'),legend=node('legend',`${step*4+i+1}. ${q[0]}`);field.append(legend);
 [...q[1],'Ich weiß es nicht'].forEach((option,j)=>{const label=node('label');label.className='option';const input=node('input');input.type='radio';input.name=`q${i}`;input.value=j;input.checked=answers[step][i]===j;input.onchange=()=>{answers[step][i]=j;};label.append(input,document.createTextNode(option));field.append(label);});
 const clear=node('button','Antwort freilassen');clear.type='button';clear.onclick=()=>{answers[step][i]=null;render();};field.append(clear);$('stage').append(field);});
 }else{
 $('progress').textContent='Schreiben · nur eine Aufgabe';
 $('stage').append(node('p','Wähle eine Aufgabe. Du darfst eine leichtere wählen oder Schreiben auslassen. Die Auswahl beweist kein Niveau. Benutze erfundene Angaben.'));
 const select=node('select');select.id='writing-choice';select.setAttribute('aria-label','Schreibaufgabe');
 const empty=node('option','Schreiben auslassen');empty.value='';select.append(empty);
 writingTasks.forEach((t,i)=>{const option=node('option',`W${i+1}`);option.value=String(i);select.append(option);});select.value=writingTask===null?'':String(writingTask);
 select.onchange=()=>{capture();const next=select.value===''?null:Number(select.value);if(next!==writingTask){writing.fill('');writingTask=next;}render();};$('stage').append(select);
 if(writingTask!==null){const label=node('label',writingTasks[writingTask]);const area=node('textarea');area.id='writing';area.maxLength=1800;area.lang='de';area.spellcheck=false;area.value=writing[writingTask];area.oninput=()=>{writing[writingTask]=area.value;};label.append(area);$('stage').append(label);}
 }
 $('back').disabled=step===0;$('next').textContent=step===3?'Antworten prüfen':'Weiter';$('stop').hidden=step===3;
 $('progress').tabIndex=-1;$('progress').focus();
}
function capture(){if(step<3)placement[step].questions.forEach((q,i)=>{const input=document.querySelector(`input[name=q${i}]:checked`);answers[step][i]=input?Number(input.value):null;});else if(writingTask!==null&&$('writing'))writing[writingTask]=$('writing').value;}
function review(){
 $('intro').hidden=true;$('test').hidden=true;$('result').hidden=false;$('scores').replaceChildren();
 $('review').replaceChildren();$('result-title').textContent=path==='beginner'?'A1-Einstieg besprechen':'Prüfe deine Antworten';
 if(path==='beginner')$('review').append(node('p','Du hast noch nie Deutsch gelernt. Du brauchst nichts zu raten. Besprich mit Ralph den A1-Einstieg. Das ist keine geprüfte Sprachleistung und keine Buchung.'));
 else{
 placement.forEach((p,b)=>{const h=node('h3',`Block ${b+1} · ${p.title}`);$('review').append(h,node('p',p.text));p.questions.forEach((q,i)=>{$('review').append(node('p',`${b*4+i+1}. ${q[0]} → ${answers[b][i]===null?'nicht bearbeitet':answers[b][i]===3?'Ich weiß es nicht':q[1][answers[b][i]]}`));});const edit=node('button',`Block ${b+1} ändern`);edit.type='button';edit.disabled=attempted!==null;edit.onclick=()=>{if(attempted!==null)return;step=b;$('result').hidden=true;$('test').hidden=false;render();};$('review').append(edit);});
 $('review').append(node('h3','Schreibprobe'),node('p',writingTask===null?'nicht bearbeitet':writingTasks[writingTask]),node('p',writingTask===null?'':writing[writingTask]||'noch kein Text'));
 const edit=node('button','Schreiben ändern');edit.type='button';edit.disabled=attempted!==null;edit.onclick=()=>{if(attempted!==null)return;step=3;$('result').hidden=true;$('test').hidden=false;render();};$('review').append(edit);
 if(!hasLanguageEvidence())$('review').append(node('p','Noch keine auswertbare Sprachprobe: nur „Ich weiß es nicht“ oder leere Antworten. Du darfst ändern oder mit Ralph sprechen.'));
 }
 $('restart').hidden=path!=='beginner';$('restart').disabled=attempted!==null;$('result').focus();
}
function profile(scores){if(path==='beginner')return;scores.forEach(s=>{$('scores').append(node('p',`Block ${s.block}: Lesen ${s.reading.correct}/${s.reading.total}; Grammatik ${s.grammar.correct}/${s.grammar.total}; Wortschatz ${s.vocabulary.correct}/${s.vocabulary.total}. Richtig ${s.correct}, falsch ${s.wrong}, weiß nicht ${s.unknown}, nicht bearbeitet ${s.unanswered}. Kurze Aufgabenstichprobe, kein GER-Niveau.`));});}
$('start').onclick=()=>{if(attempted!==null)return;path='test';$('intro').hidden=true;$('result').hidden=true;$('test').hidden=false;render();};
$('beginner').onclick=()=>{if(attempted!==null)return;path='beginner';answers.forEach(a=>a.fill(null));writing.fill('');writingTask=null;review();};
$('restart').onclick=()=>{if(attempted!==null)return;path='test';step=0;$('result').hidden=true;$('test').hidden=false;render();};
$('back').onclick=()=>{if(attempted!==null)return;capture();if(step>0){step--;render();}};
$('stop').onclick=()=>{if(attempted!==null)return;capture();step=3;render();};
$('test').onsubmit=e=>{e.preventDefault();if(attempted!==null)return;capture();if(step<3){step++;render();}else review();};
$('download').onclick=()=>{const report={version:PLACEMENT_VERSION,submissionId,submissionState:stored?'confirmed':attempted!==null?'unconfirmed':'not_sent',path,answers,writing,writingTask,writingStatus:writing.some(v=>v.trim())?'pending_teacher_review':'not_assessed',listening:'not_assessed',speaking:'not_assessed',courseRecommendation:null};const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=node('a');a.href=url;a.download='VIVE-respuestas-v2-1.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('send').onclick=async()=>{
 if(!token||sending||stored||blocked)return;
 if(!$('consent').checked){$('save-status').textContent='Bitte lies den Datenschutzhinweis und bestätige den freiwilligen Versand.';return;}
 if(path!=='beginner'&&!hasLanguageEvidence()){$('save-status').textContent='Noch keine auswertbare Sprachprobe. Du musst nichts raten. Sprich mit Ralph.';return;}
 const body=JSON.stringify({id:submissionId,token,version:PLACEMENT_VERSION,path,writingTask,answers,writing,consent:true});
 if(attempted!==null&&attempted!==body){$('save-status').textContent='Der erste Versuch könnte gespeichert sein. Geänderte Antworten werden nicht als zweite Abgabe gesendet.';return;}
 attempted=body;review();sending=true;$('send').disabled=true;$('save-status').textContent='Wird gesendet …';
 try{const response=await fetch('/api/placement',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body,signal:AbortSignal.timeout(25000)});const result=await response.json();
 if(response.status===409){blocked=true;$('save-status').textContent='Für diese Anfrage gibt es bereits eine andere Abgabe. Ralph muss sie prüfen. Nichts ersetzt.';return;}
 if(response.status===401){blocked=true;$('save-status').textContent='Der Link ist nicht mehr gültig. Sichere deine Antworten und sprich mit Ralph. Speicherung nicht bestätigt.';return;}
 if(!response.ok||result.ok!==true||result.stored!==true||result.id!==submissionId||result.version!==PLACEMENT_VERSION||!confirmedProfile(result))throw new Error('unconfirmed');
 stored=true;profile(result.reading);$('save-status').textContent=result.test?'INTERNER TEST: als TEST gespeichert. Kein automatischer Versand.':path==='beginner'?'Dein Wunsch nach A1-Orientierung ist gespeichert. Kein Niveau geprüft, kein Platz reserviert.':writing.some(v=>v.trim())?'Antworten gespeichert. Ralph prüft deine Schreibprobe. Hören und Sprechen fehlen. Kein Platz reserviert.':'Antworten gespeichert. Schreiben, Hören und Sprechen sind nicht geprüft. Kein Platz reserviert.';$('send').textContent='Gespeichert';
 }catch{$('save-status').textContent='Speicherung nicht bestätigt. Du darfst genau denselben Versuch erneut senden. Änderungen sind gesperrt. Lade vor dem Schließen deine Antworten herunter.';}
 finally{sending=false;$('send').disabled=stored||blocked;}
};
window.addEventListener('beforeunload',e=>{if(!stored&&hasUnsavedContent()){e.preventDefault();e.returnValue='';}});
