const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const code = fs.readFileSync(path.join(__dirname,'Code.gs'),'utf8');

function fixture() {
  let clock = Date.parse('2026-11-20T14:00:00+09:00');
  class Clock extends Date {
    constructor(...a) { super(...(a.length ? a : [clock])); }
    static now() { return clock; }
  }
  class Sheet {
    constructor() { this.rows=[]; }
    getLastRow() { return this.rows.length; }
    setFrozenRows() {}
    getRange(r,c,n=1,w=1) {
      const s=this;
      return {
        setValues(list){ list.forEach((line,i)=>{const row=s.rows[r-1+i]||=[];line.forEach((v,j)=>row[c-1+j]=v);});return this; },
        getValues(){ return Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>s.rows[r-1+i]?.[c-1+j]??'')); },
        setValue(v){return this.setValues([[v]]);},setFontWeight(){return this;}
      };
    }
    deleteRows(row,count){this.rows.splice(row-1,count);}
  }
  const tabs=new Map(), timers=[], messages=[], logs=[], calls=[], input=new Map(), mem=new Map();
  const props={
    getProperty:k=>mem.get(k)??null, setProperty:(k,v)=>mem.set(k,String(v)),
    setProperties(o){Object.entries(o).forEach(([k,v])=>this.setProperty(k,v));},
    deleteProperty:k=>mem.delete(k)
  };
  const book={getId:()=>'book',getUrl:()=>'https://example.invalid/book',
    getSheetByName:k=>tabs.get(k)||null,insertSheet(k){const s=new Sheet();tabs.set(k,s);return s;}};
  const env={workflow:'active',running:false,failSend:0,tgError:0,updates:[], clockError:false, reads:0};
  const token=42+':'+'test_only', state={sources:{},seen:{},pending:{},notifications:{}};
  function response(data,status=200){return {getResponseCode:()=>status,getContentText:()=>typeof data==='string'?data:JSON.stringify(data)};}
  function fetch(url,opts={}) {
    calls.push(url);
    if(url.includes('api.telegram.org')){
      const p=JSON.parse(opts.payload);
      if(env.tgError)throw new Error('Cannot fetch '+url);
      if(url.endsWith('/getMe'))return response({ok:true,result:{username:'News_alert_test172_bot'}});
      if(url.endsWith('/getUpdates'))return response({ok:true,result:env.updates});
      if(url.endsWith('/sendMessage')){
        if(env.failSend){const status=env.failSend;env.failSend=0;return response({ok:false,parameters:{retry_after:2}},status);}
        messages.push(p);return response({ok:true,result:{message_id:messages.length}});
      }
    }
    if(url.includes('/api.github.com/')){
      if(env.clockError) return response({},403);
      if(url.includes('/contents/state.json')) return response(state);
      if(url.includes('/runs?'))return response({workflow_runs:[{status:env.running?'in_progress':'completed'}]});
      return response({state:env.workflow});
    }
    if(url.includes('raw.githubusercontent.com'))return response(state);
    if(input.has(url)){const value=input.get(url);return typeof value==='number'?response('',value):response(value);}
    return response('<html><div class="bbs-view-cont">기타 공지</div></html>');
  }
  const ctx=vm.createContext({console:{log:m=>logs.push(m),error:m=>logs.push(m)},Date:Clock,
    PropertiesService:{getScriptProperties:()=>props}, LockService:{getScriptLock:()=>({waitLock(){},tryLock:()=>true,releaseLock(){}})},
    SpreadsheetApp:{create:()=>book,openById:()=>book,flush(){}},
    Utilities:{formatDate(d,tz,p){const k=new Date(d.getTime()+9*3600000);return p==='H'?String(k.getUTCHours()):k.toISOString().slice(0,19).replace('T',' ');},
      getUuid:()=>crypto.randomUUID(),computeDigest:(alg,v)=>crypto.createHash('sha256').update(v).digest(),base64EncodeWebSafe:v=>Buffer.from(v).toString('base64url'),
      DigestAlgorithm:{SHA_256:1},sleep(){}},
    ScriptApp:{getProjectTriggers:()=>timers.slice(),deleteTrigger(t){timers.splice(timers.indexOf(t),1);},
      newTrigger(name){return {timeBased(){return this;},everyMinutes(n){assert.equal(n,5);return this;},create(){timers.push({getHandlerFunction:()=>name});}};}},
    UrlFetchApp:{fetch,fetchAll(requests){return requests.map(r=>fetch(r.url,r));}}
  });
  vm.runInContext(code,ctx);
  const sources=vm.runInContext('TRIAL.sources',ctx);
  const idFor=(s,n)=>s[0]+':'+n+(s[3]==='sanction'?':1':'');
  function page(s,posts){
    return '<ul>'+posts.map(([n,title,dept=''])=>{
      const url=ctx.tgCanonical_(s,idFor(s,n)).replace(/^https:\/\/[^/]+/,'');
      if(s[3]==='sanction')return '<tr><td>1</td><td>'+title+'</td><td>20261120</td><td><a href="'+url+'">보기</a></td></tr>';
      const tag=s[3].startsWith('fsc')?'li':'tr';
      return '<'+tag+'><a href="'+url+'">'+title+'</a><span>'+dept+'</span></'+tag+'>';
    }).join('')+'</ul>';
  }
  for(const s of sources){input.set(s[2],page(s,[[100,'기준 자료']]));state.seen[idFor(s,100)]='baseline';state.sources[s[0]]={last_success:new Date(clock).toISOString()};}
  ctx.setupTrial(); props.setProperty('TELEGRAM_BOT_TOKEN',token);
  function testChat(){props.setProperty('TELEGRAM_CHAT_ID','1234');ctx.testTelegram();}
  function activate(){testChat();ctx.prepareTelegramSwitch();env.workflow='disabled_manually';ctx.runScheduledProbe();}
  return {ctx,env,props,book,tabs,timers,messages,logs,calls,input,state,token,sources,page,testChat,activate,
    advance(minutes){clock+=minutes*60000;},setTime(s){clock=Date.parse(s);}};
}

test('shadow mode and manual receive test never turn on live delivery',()=>{
  const f=fixture();f.testChat();f.ctx.runScheduledProbe();
  assert.equal(f.messages.length,1);assert.equal(f.props.getProperty('TG_MODE'),null);
  assert.equal(f.timers.length,1);
});
test('private challenge links exactly the user who possesses the fresh code',()=>{
  const f=fixture();f.ctx.testTelegram();
  const key=JSON.parse(f.props.getProperty('TG_PAIR'));
  const m={text:'/start '+key.code,date:Math.floor(key.created/1000),chat:{type:'private',id:1234},from:{id:1234}};
  f.env.updates=[{message:{...m,text:'/start'}},{message:{...m,chat:{type:'group',id:-1}}},{message:{...m,forward_origin:{}}}];
  f.ctx.testTelegram();assert.equal(f.messages.length,0);
  f.env.updates.push({message:m});f.ctx.testTelegram();
  assert.equal(f.props.getProperty('TELEGRAM_CHAT_ID'),'1234');assert.equal(f.messages.length,1);
});
test('the original sender continues during preparation and until its final run finishes',()=>{
  const f=fixture();f.testChat();f.ctx.prepareTelegramSwitch();f.ctx.prepareTelegramSwitch();
  f.ctx.runScheduledProbe();assert.equal(f.props.getProperty('TG_MODE'),'waiting');
  f.env.workflow='disabled_manually';f.env.running=true;f.ctx.runScheduledProbe();
  assert.equal(f.props.getProperty('TG_MODE'),'waiting');assert.equal(f.timers.length,1);
  f.env.running=false;f.ctx.runScheduledProbe();assert.equal(f.props.getProperty('TG_MODE'),'live');
  assert.equal(f.messages.length,1);
  f.calls.length=0;f.ctx.runScheduledProbe();assert(!f.calls.some(x=>x.includes('github')));
});
test('handoff covers a trial discovery and a pending GitHub item without replaying a sent or filtered post',()=>{
  const f=fixture();f.testChat();f.ctx.prepareTelegramSwitch();
  const s=f.sources[0];f.input.set(s[2],f.page(s,[[105,'보험 105'],[104,'보험 104'],[103,'보험 103'],[102,'보험 102'],[100,'기준 자료']]));
  f.ctx.runScheduledProbe();f.state.seen['fsc_press:104']='sent';f.state.seen['fsc_press:103']='filtered';
  f.state.seen['fsc_press:102']='pending';f.state.pending['fsc_press:102']={title:'보험 102',url:'https://www.fsc.go.kr/no010101/102'};
  f.env.workflow='disabled_manually';f.ctx.runScheduledProbe();f.ctx.runScheduledProbe();
  assert.deepEqual(f.messages.slice(1).map(x=>x.text.split('\n')[1]).sort(),['보험 102','보험 105']);
});
test('inspects the list and article only for fresh posts and sends exactly three lines',()=>{
  const f=fixture();f.activate();const s=f.sources[0];
  f.input.set(s[2],f.page(s,[[104,'퇴직연금 소식'],[103,'시장 동향'],[102,'점검 예고','보험과'],[101,'기타 소식'],[100,'기준 자료']]));
  f.input.set(s[2]+'/103','<nav>메뉴 보험</nav><div class="bbs-view-cont"><div>국채 동향</div><div>보험회사</div></div><footer>끝</footer>');
  f.input.set(s[2]+'/101','<nav>메뉴 보험</nav><div class="bbs-view-cont"><div>주가 정보</div></div><footer>보험</footer>');
  f.ctx.runScheduledProbe();f.ctx.runScheduledProbe();
  const msgs=f.messages.slice(1).map(x=>x.text);
  assert.equal(msgs.length,3);assert(msgs.includes('[금융위원회 / 보도자료]\n시장 동향\nhttps://www.fsc.go.kr/no010101/103'));
  assert(msgs.every(s=>s.split('\n').length===3));assert(!msgs.some(s=>s.includes('기타 소식')));
});
test('a rate-limited post is retained and retried, never replayed after acceptance',()=>{
  const f=fixture();f.activate();const s=f.sources[0];f.input.set(s[2],f.page(s,[[101,'보험 소식'],[100,'기준 자료']]));
  f.env.failSend=429;f.ctx.runScheduledProbe();assert.equal(f.messages.length,1);
  assert.equal(f.tabs.get('텔레그램 발송').rows[1][5],'재시도');f.ctx.runScheduledProbe();assert.equal(f.messages.length,1);
  f.advance(5);f.ctx.runScheduledProbe();f.ctx.runScheduledProbe();assert.equal(f.messages.length,2);
});
test('night is silent and a source or transition failure does not remove its checkpoint',()=>{
  const f=fixture();f.testChat();f.ctx.prepareTelegramSwitch();f.env.workflow='disabled_manually';f.env.clockError=true;
  f.ctx.runScheduledProbe();assert.equal(f.props.getProperty('TG_MODE'),'waiting');f.env.clockError=false;
  f.ctx.runScheduledProbe();const s=f.sources[0],before=f.props.getProperty('TG_KNOWN_'+s[0]);f.input.set(s[2],503);f.ctx.runScheduledProbe();
  assert.equal(f.props.getProperty('TG_KNOWN_'+s[0]),before);f.calls.length=0;
  f.setTime('2026-11-20T21:00:00+09:00');f.ctx.runScheduledProbe();assert.equal(f.calls.length,0);
});
test('a burst crosses to the second list page and duplicate anchors are only delivered once',()=>{
  const f=fixture();f.activate();const s=f.sources[0];f.input.set(s[2],f.page(s,Array.from({length:10},(_,i)=>[112-i,'보험 '+(112-i)])));
  f.input.set(s[2]+'?curPage=2',f.page(s,[[103,'보험 103'],[102,'보험 102'],[101,'보험 101'],[100,'기준 자료']]));
  f.ctx.runScheduledProbe();f.ctx.runScheduledProbe();assert.equal(f.messages.length,13);
  assert.equal(new Set(f.messages.map(x=>x.text)).size,13);
});
test('network errors do not expose token-bearing URLs in thrown errors or logs',()=>{
  const f=fixture();f.env.tgError=1;assert.throws(()=>f.ctx.testTelegram(), e=>!String(e).includes(f.token)&&String(e).includes('텔레그램'));
  assert(!f.logs.some(x=>String(x).includes(f.token)));
});

