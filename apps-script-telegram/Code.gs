/** 보험정책 모니터 | Google Apps Script + Telegram
 * 기존 시험 프로젝트의 Code.gs 전체에 붙여넣습니다. 기존 기록표와 5분 트리거를 재사용합니다.
 * testTelegram으로 휴대폰 수신 확인 → prepareTelegramSwitch 실행 → GitHub monitor.yml 비활성화.
 * 상태는 기존 기록표의 요약 탭에서 확인합니다. */
const TRIAL = {
  version: '2026-11-20-telegram-v1', timezone: 'Asia/Seoul',
  githubState: 'https://raw.githubusercontent.com/RK-172/insurance-news-alert/main/state.json',
  sources: [
    ['fsc_press','금융위원회 / 보도자료','https://www.fsc.go.kr/no010101','fsc'],
    ['fsc_explain','금융위원회 / 보도설명자료','https://www.fsc.go.kr/no010102','fsc'],
    ['fsc_rules','금융위원회 / 입법예고·규정변경예고','https://www.fsc.go.kr/po040301','fsc_rules'],
    ['fss_press','금융감독원 / 보도자료','https://www.fss.or.kr/fss/bbs/B0000188/list.do?menuNo=200218','fss'],
    ['fss_explain','금융감독원 / 보도설명자료','https://www.fss.or.kr/fss/bbs/B0000189/list.do?menuNo=200219','fss'],
    ['fss_sanction','금융감독원 / 제재정보','https://www.fss.or.kr/fss/job/openInfo/list.do?menuNo=200476','sanction'],
    ['fss_rules','금융감독원 / 세칙 제·개정 예고','https://www.fss.or.kr/fss/job/lrgRegItnPrvntc/list.do?menuNo=200489','fss_rules']
  ],
  keywords: ['보험','생명','설계사','계리','지급여력','k-ics','킥스','ifrs17','csm','퇴직연금','해약','금융소비자','소비자보호','소비자 보호','금융회사','내부통제','개인정보','개인 정보','신용정보','생산적 금융','국민성장펀드','금융보안','금융 보안','금융지주','금융복합','자본규제','판매수수료','판매 수수료','금융상품','실손','재보험','예금자보호','금융산업의 구조개선','금융산업구조개선','금산법']
};

function setupTrial() {
  if (PropertiesService.getScriptProperties().getProperty('TG_MODE')) {
    console.log('이미 텔레그램 전환을 설정했습니다. 상태는 기록표 요약에서 확인하세요.');
    return;
  }
  const lock=LockService.getScriptLock();lock.waitLock(10000);
  try {
    const props=PropertiesService.getScriptProperties();
    let id=props.getProperty('TRIAL_SHEET_ID');
    const book=id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create('보험정책 모니터 — Google 시험 기록');
    props.setProperty('TRIAL_SHEET_ID',book.getId());
    ensureSheets_(book);
    // Re-running setup does not create duplicate scheduled triggers or reset observations.
    const triggers=ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='runScheduledProbe');
    if (!triggers.length) ScriptApp.newTrigger('runScheduledProbe').timeBased().everyMinutes(5).create();
    triggers.slice(1).forEach(t=>ScriptApp.deleteTrigger(t));
    book.getSheetByName('요약').getRange(1,1,5,2).setValues([
      ['항목','값'],['상태','시험 활성화 — 텔레그램 발송 없음'],['운영시간','한국시간 06:00~21:00'],
      ['기록 URL',book.getUrl()],['주의','5분 타이머 설정. 실제 간격은 실행기록으로 검증합니다.']
    ]);
    console.log('설정 완료. 기록표: '+book.getUrl());
  } finally {lock.releaseLock();}
  runProbe_(true);
}
function runScheduledProbe() { telegramTick_(false); }
function runTrialNow() { telegramTick_(true); }
function showTrialLink() {
  const id=PropertiesService.getScriptProperties().getProperty('TRIAL_SHEET_ID');
  console.log(id ? 'https://docs.google.com/spreadsheets/d/'+id+'/edit' : 'setupTrial을 먼저 실행하세요.');
}
function stopTrial() {
  ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='runScheduledProbe').forEach(t=>ScriptApp.deleteTrigger(t));
  const id=PropertiesService.getScriptProperties().getProperty('TRIAL_SHEET_ID');
  if(id) SpreadsheetApp.openById(id).getSheetByName('요약').getRange(2,2).setValue('시험 중지');
  console.log('Google 시험 타이머 중지. GitHub 알림에는 영향 없습니다.');
}
function activeHours_(now) {const hour=Number(Utilities.formatDate(now,TRIAL.timezone,'H'));return hour>=6 && hour<21;}
function runProbe_(manual) {
  const started=new Date();
  if (!manual && !activeHours_(started)) return; // No network, properties or sheets at night.
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000)){console.log('이전 점검 실행 중: 중복 생략');return;}
  try {
    const props=PropertiesService.getScriptProperties();const id=props.getProperty('TRIAL_SHEET_ID');
    if(!id){console.log('setupTrial을 먼저 실행하세요.');return;}
    const book=SpreadsheetApp.openById(id);const previous=props.getProperty('LAST_TIMER_START');
    const gap=(!manual && previous) ? (started.getTime()-Number(previous))/60000 : '';
    const priorDate=previous ? kst_(new Date(Number(previous))).slice(0,10) : '';
    const overnight=priorDate && priorDate!==kst_(started).slice(0,10);
    if(!manual) props.setProperty('LAST_TIMER_START',String(started.getTime()));
    const requests=TRIAL.sources.map(s=>({url:s[2],muteHttpExceptions:true,followRedirects:true}));
    requests.push({url:TRIAL.githubState+'?trial='+started.getTime(),muteHttpExceptions:true,followRedirects:true});
    let responses;
    try {responses=UrlFetchApp.fetchAll(requests);} catch(error) {
      append_(book,'실행기록',[[kst_(started),manual?'수동':'자동',gap,overnight?'야간 이후':'주간',(Date.now()-started.getTime())/1000,0,7,0,'전체 요청 실패: '+String(error).slice(0,180)]]);
      return;
    }
    let github=null;let githubNote='GitHub 상태 조회 실패';
    try {if(responses[7].getResponseCode()===200){github=JSON.parse(responses[7].getContentText());githubNote=github.checked_at||'시각 없음';}}catch(ignore){}
    let ok=0,fail=0,newTotal=0;const errors=[],sourceRows=[],newRows=[];const updates={};
    TRIAL.sources.forEach((source,index)=>{
      const response=responses[index];const status=response.getResponseCode();
      try {
        if(status!==200) throw new Error('HTTP '+status);
        const items=parseBoard_(response.getContentText('UTF-8'),source);
        const propertyKey='SEEN_'+source[0];const raw=props.getProperty(propertyKey);
        const seen=new Set(raw ? JSON.parse(raw) : []);const baseline=raw===null;
        let discovered=0;
        items.forEach(item=>{
          if(!seen.has(item.id) && !baseline){
            discovered++;newTotal++;
            const record=github && github.notifications && github.notifications[item.id];
            const sentAt=record ? record.sent_at : '';
            const difference=sentAt ? (new Date(sentAt).getTime()-started.getTime())/60000 : '';
            newRows.push([kst_(started),source[1],item.id,item.title,item.url,relevant_(item.title)?'제목 키워드 일치':'미분류（시험은 모든 신규 제목 기록）',sentAt,github && github.seen ? (github.seen[item.id]||'미처리'):'확인 불가',difference]);
          }
          seen.add(item.id);
        });
        updates[propertyKey]=JSON.stringify(Array.from(seen).slice(-200));
        sourceRows.push([kst_(started),source[1],status,items.length,discovered,baseline?'첫 기준 저장':'정상']);ok++;
      } catch(error) {fail++;errors.push(source[0]+': '+String(error).slice(0,140));sourceRows.push([kst_(started),source[1],status,0,0,String(error).slice(0,180)]);}
    });
    // Log before marking seen: sheet failures must not silently lose observations.
    append_(book,'신규자료',newRows);
    if(github) reconcileGithub_(book,github);
    append_(book,'기관별점검',sourceRows);
    append_(book,'실행기록',[[kst_(started),manual?'수동':'자동',gap,overnight?'야간 이후':'주간',(Date.now()-started.getTime())/1000,ok,fail,newTotal,errors.join(' / ')]]);
    const githubAge=github && github.checked_at ? (started.getTime()-new Date(github.checked_at).getTime())/60000 : '';
    append_(book,'GitHub비교',[[kst_(started),githubNote,githubAge,github && github.finished_at ? github.finished_at : '',github ? Object.keys(github.errors||{}).length : '']]);
    if(Object.keys(updates).length) props.setProperties(updates,false);
    book.getSheetByName('요약').getRange(6,1,6,2).setValues([
      ['최근 점검',kst_(started)],['최근 자동 실행 간격(분)',gap],['최근 수집 성공 / 실패',ok+' / '+fail],
      ['최근 신규 자료',newTotal],['최근 GitHub 점검 경과(분)',githubAge],['버전',TRIAL.version]
    ]);
    console.log('점검 완료: 성공 '+ok+', 실패 '+fail+', 신규 '+newTotal+'. 기록표: '+book.getUrl());
  } catch(error) {console.error('시험 기록 오류: '+String(error).slice(0,250));}
  finally {lock.releaseLock();}
}
function reconcileGithub_(book,github) {
  const sheet=book.getSheetByName('신규자료');const last=sheet.getLastRow();if(last<2)return;
  const start=Math.max(2,last-299);const rows=sheet.getRange(start,1,last-start+1,9).getValues();
  let changed=false;
  const result=rows.map(row=>{
    const record=(github.notifications||{})[row[2]];const status=(github.seen||{})[row[2]]||'미처리';
    const sentAt=record?record.sent_at:'';
    const discovered=new Date(String(row[0]).replace(' ','T')+'+09:00');
    const difference=sentAt && !isNaN(discovered.getTime()) ? (new Date(sentAt).getTime()-discovered.getTime())/60000 : '';
    if(row[6]!==sentAt || row[7]!==status || row[8]!==difference)changed=true;
    return [sentAt,status,difference];
  });
  if(changed)sheet.getRange(start,7,result.length,3).setValues(result);
}
function ensureSheets_(book) {
  const headers={
    '요약':['항목','값'],
    '실행기록':['시작(KST)','실행유형','자동실행 간격(분)','간격 구분','조회·기록 소요(초)','성공기관','실패기관','신규건수','오류'],
    '기관별점검':['확인(KST)','기관/분류','HTTP','목록건수','신규건수','결과'],
    '신규자료':['Google 발견(KST)','기관/분류','게시물 ID','제목','원문','관련성 참고','GitHub 발송(UTC)','GitHub 처리상태(최근 확인)','GitHub발송-Google발견(분)'],
    'GitHub비교':['Google 확인(KST)','GitHub 최근 점검(UTC)','GitHub 점검 경과(분)','GitHub 종료(UTC)','GitHub 수집오류 수']
  };
  Object.keys(headers).forEach(name=>{
    let sheet=book.getSheetByName(name);if(!sheet)sheet=book.insertSheet(name);
    sheet.getRange(1,1,1,headers[name].length).setValues([headers[name]]).setFontWeight('bold');sheet.setFrozenRows(1);
  });
}
function append_(book,name,rows) {
  if(!rows.length)return;
  const sheet=book.getSheetByName(name);
  const clean=rows.map(row=>row.map(v=>typeof v==='string' && /^[=+@-]/.test(v)?"'"+v:v));
  sheet.getRange(sheet.getLastRow()+1,1,clean.length,clean[0].length).setValues(clean);
  const keep=name==='기관별점검'?15000:3000;
  if(sheet.getLastRow()>keep+1)sheet.deleteRows(2,sheet.getLastRow()-keep-1);
}
function kst_(date) {return Utilities.formatDate(date,TRIAL.timezone,'yyyy-MM-dd HH:mm:ss');}
function relevant_(value) {const s=value.toLowerCase();return TRIAL.keywords.some(k=>s.includes(k))||/\bga\b/i.test(s);}
function decode_(value) {
  return String(value).replace(/&#x([\da-f]+);/gi,(_,v)=>String.fromCodePoint(parseInt(v,16)))
    .replace(/&#(\d+);/g,(_,v)=>String.fromCodePoint(Number(v)))
    .replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&');
}
function plain_(value) {return decode_(String(value).replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();}
function attr_(attrs,name) {const m=attrs.match(new RegExp('(?:^|\\s)'+name+'\\s*=\\s*(["\x27])([\\s\\S]*?)\\1','i'));return m?decode_(m[2]):'';}
function query_(href,name) {const m=href.match(new RegExp('[?&]'+name+'=([^&#]*)'));return m?decodeURIComponent(m[1].replace(/\+/g,' ')):'';}
function parseBoard_(body,source) {
  const [key,label,base,kind]=source;const origin=base.match(/^https:\/\/[^/]+/)[0];const items=new Map();
  const lowerBody=body.toLowerCase();
  const anchors=/<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;let match;
  while((match=anchors.exec(body))!==null){
    const href=attr_(match[1],'href');let ident='',url='';
    if(kind==='fsc'){
      const prefix=base.slice(origin.length);const m=href.match(new RegExp('^'+prefix+'/(\\d+)'));
      if(!m)continue;ident=m[1];url=origin+prefix+'/'+ident;
    }else if(kind==='fsc_rules'){
      if(!/\/?po040301\/view\?/.test(href))continue;ident=query_(href,'noticeId');if(!ident)continue;url=origin+'/po040301/view?noticeId='+ident;
    }else if(kind==='fss'){
      const board=base.match(/\/bbs\/([^/]+)\//)[1];if(!href.includes('/bbs/'+board+'/view.do?'))continue;
      ident=query_(href,'nttId');if(!ident)continue;url=origin+'/fss/bbs/'+board+'/view.do?nttId='+ident+'&menuNo='+query_(base,'menuNo');
    }else if(kind==='sanction'){
      if(!href.includes('/job/openInfo/view.do?'))continue;const exam=query_(href,'examMgmtNo'),seq=query_(href,'emOpenSeq');
      if(!exam||!seq)continue;ident=exam+':'+seq;url=origin+'/fss/job/openInfo/view.do?menuNo=200476&examMgmtNo='+exam+'&emOpenSeq='+seq;
    }else{
      if(!href.includes('/job/lrgRegItnPrvntc/view.do?'))continue;ident=query_(href,'lrgSlno');if(!ident)continue;
      url=origin+'/fss/job/lrgRegItnPrvntc/view.do?menuNo=200489&lrgSlno='+ident;
    }
    let title=attr_(match[1],'title')||plain_(match[2]);
    if(kind==='sanction'){
      const before=body.slice(0,match.index);const begin=before.toLowerCase().lastIndexOf('<tr');const end=body.toLowerCase().indexOf('</tr>',match.index);
      const row=begin>=0 && end>=0 ? body.slice(begin,end) : '';const cells=Array.from(row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi));
      if(cells.length>=3)title=plain_(cells[1][1])+' / '+plain_(cells[2][1]);
    }
    title=plain_(title);if(!title)continue;
    const tag=kind.indexOf('fsc')===0?'li':'tr';
    const begin=lowerBody.lastIndexOf('<'+tag,match.index);
    const end=lowerBody.indexOf('</'+tag+'>',match.index);
    const contextMatch=begin>=0 && end>=0 && end-begin<32000 && relevant_(plain_(body.slice(begin,end)));
    const id=key+':'+ident;items.set(id,{id,title,url,label,contextMatch});
  }
  if(!items.size)throw new Error('목록을 식별하지 못함: 사이트 차단/구조 변경 확인 필요');
  return Array.from(items.values());
}

const TG_CONFIG = {
  bot: 'News_alert_test172_bot',
  repository: 'https://api.github.com/repos/RK-172/insurance-news-alert',
  workflow: '/actions/workflows/monitor.yml',
  journal: '텔레그램 발송',
  header: ['게시물 ID','기관/분류','제목','원문','선별 근거','상태','발송 시각(KST)','메모']
};

// Run only from the editor. A message is sent only to the configured private chat.
function testTelegram() {
  const lock = LockService.getScriptLock();
  lock.waitLock(45000);
  try {
    const props = PropertiesService.getScriptProperties();
    const token = String(props.getProperty('TELEGRAM_BOT_TOKEN') || '').trim();
    if (!/^\d+:[a-zA-Z0-9_-]+$/.test(token)) {
      throw new Error('프로젝트 설정 → 스크립트 속성에 TELEGRAM_BOT_TOKEN을 저장하세요.');
    }
    const bot = tgApi_(token, 'getMe', {});
    if (String(bot.username).toLowerCase() !== TG_CONFIG.bot.toLowerCase()) {
      throw new Error('@' + TG_CONFIG.bot + '의 토큰을 확인하세요.');
    }
    let chat = String(props.getProperty('TELEGRAM_CHAT_ID') || '').trim();
    if (!chat) chat = tgPair_(props, token);
    if (!chat) return;
    if (!/^\d+$/.test(chat)) throw new Error('TELEGRAM_CHAT_ID에 본인 개인 채팅의 숫자 ID를 입력하세요.');
    tgSend_(token, chat, '[보험정책 모니터 / 연결 시험]\nGoogle에서 보낸 텔레그램 시험 메시지입니다.');
    props.setProperties({TELEGRAM_CHAT_ID: chat, TG_TESTED: tgFingerprint_(token, chat)}, false);
    props.deleteProperty('TG_PAIR');
    console.log('시험 메시지를 보냈습니다. 휴대폰 수신을 확인하고 prepareTelegramSwitch를 실행하세요.');
  } finally { lock.releaseLock(); }
}

function tgPair_(props, token) {
  const now = Date.now();
  let pair = JSON.parse(props.getProperty('TG_PAIR') || 'null');
  if (!pair || now - pair.created > 20 * 60000) {
    pair = {code: Utilities.getUuid().replace(/-/g, ''), created: now};
    props.setProperty('TG_PAIR', JSON.stringify(pair));
  } else {
    const updates = tgApi_(token, 'getUpdates', {limit: 100, timeout: 0});
    for (const update of updates) {
      const m = update.message;
      if (m && m.chat && m.from && m.chat.type === 'private' && !m.from.is_bot &&
          m.from.id === m.chat.id && !m.forward_origin && m.date >= Math.floor(pair.created / 1000) &&
          m.text === '/start ' + pair.code) return String(m.chat.id);
    }
  }
  console.log('본인 텔레그램에서 아래 링크를 열고 시작(Start)을 누른 후 testTelegram을 다시 실행하세요. 링크는 20분 동안 본인만 사용하세요.\nhttps://t.me/' + TG_CONFIG.bot + '?start=' + pair.code +
    '\n시작 단추가 안 보이면 해당 봇과의 1:1 대화에 다음 한 줄을 보내세요.\n/start ' + pair.code);
  return '';
}

function tgFingerprint_(token, chat) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token + '\n' + chat));
}

function tgCredentials_(props) {
  const token = String(props.getProperty('TELEGRAM_BOT_TOKEN') || '').trim();
  const chat = String(props.getProperty('TELEGRAM_CHAT_ID') || '').trim();
  if (!token || !chat || tgFingerprint_(token, chat) !== props.getProperty('TG_TESTED')) {
    throw new Error('같은 토큰과 채팅 ID로 testTelegram을 먼저 실행하세요.');
  }
  return {token, chat};
}

function tgApi_(token, method, payload) {
  let status, body = {};
  try {
    const r = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(payload),
      muteHttpExceptions: true, followRedirects: false
    });
    status = r.getResponseCode();
    body = JSON.parse(r.getContentText());
  } catch (ignored) {
    // The UrlFetch exception can include the token-bearing URL. Do not log it.
    throw new Error('텔레그램 응답을 확인하지 못했습니다. 잠시 후 다시 시도하세요.');
  }
  if (status === 200 && body && body.ok === true) return body.result;
  const retry = Number(body && body.parameters && body.parameters.retry_after);
  const advice = {400:'봇과의 1:1 대화에서 시작을 누르고 채팅 ID를 확인하세요.',
    401:'봇 토큰을 확인하세요.',403:'봇 차단을 해제하고 시작을 누르세요.',
    409:'다른 수신 프로그램이 이 봇을 사용 중입니다. 기존 채팅 ID를 직접 입력하세요.',
    429:'발송 제한이 풀리면 다시 시도합니다.'};
  const error = new Error('텔레그램 HTTP ' + status + '. ' + (advice[status] || '잠시 후 다시 시도하세요.'));
  if (retry > 0 && Number.isFinite(retry)) error.retryAfter = retry;
  throw error;
}

function tgSend_(token, chat, text) {
  const receipt = tgApi_(token, 'sendMessage', {
    chat_id: chat, text: text, link_preview_options: {is_disabled: true}
  });
  if (!receipt || !receipt.message_id) throw new Error('텔레그램 발송 확인을 받지 못했습니다.');
}

// Preparation leaves the existing sender in charge. Disabling its workflow is the switch.
function prepareTelegramSwitch() {
  const lock = LockService.getScriptLock();
  lock.waitLock(45000);
  try {
    const props = PropertiesService.getScriptProperties();
    const id = props.getProperty('TRIAL_SHEET_ID');
    if (!id) throw new Error('setupTrial을 실행했던 기존 시험 프로젝트에서 열어주세요.');
    tgCredentials_(props);
    const book = SpreadsheetApp.openById(id);
    const mode = props.getProperty('TG_MODE');
    if (mode !== 'live') {
      tgGithub_(TG_CONFIG.workflow);
      tgSnapshot_(); // Verify access before the user turns off GitHub.
      tgJournal_(book);
    }
    const timers = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'runScheduledProbe');
    if (!timers.length) ScriptApp.newTrigger('runScheduledProbe').timeBased().everyMinutes(5).create();
    timers.slice(1).forEach(t => ScriptApp.deleteTrigger(t));
    if (mode === 'live') {
      tgStatus_(book, 'Google 텔레그램 발송 중');
      return;
    }
    props.setProperties({TG_MODE:'waiting', TG_ARMED_AT:props.getProperty('TG_ARMED_AT') || String(Date.now())}, false);
    tgStatus_(book, '전환 준비 완료 — GitHub 중지 대기');
    console.log('전환 준비 완료. GitHub에서 Insurance news monitor를 비활성화하세요. 주간 다음 점검에서 자동 전환됩니다.');
  } finally { lock.releaseLock(); }
}

function tgStatus_(book, message) {
  book.getSheetByName('요약').getRange(2, 2).setValue(message);
}

function tgGithub_(path, raw) {
  const url = TG_CONFIG.repository + path + (path.includes('?') ? '&' : '?') + 't=' + Date.now();
  const response = UrlFetchApp.fetch(url, {muteHttpExceptions: true, headers: {
    Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
    'Cache-Control': 'no-cache'
  }});
  if (response.getResponseCode() !== 200) {
    throw new Error('GitHub 조회 HTTP ' + response.getResponseCode() + '. 기존 기록을 보존하고 다음 점검에서 재시도합니다.');
  }
  return JSON.parse(response.getContentText());
}

function tgSnapshot_() {
  const state = tgGithub_('/contents/state.json?ref=main', true);
  if (!state || !state.seen || !state.sources || !TRIAL.sources.every(s =>
      state.sources[s[0]] && Number.isFinite(Date.parse(state.sources[s[0]].last_success)))) {
    throw new Error('GitHub의 마지막 점검 기록을 확인할 수 없습니다.');
  }
  return state;
}

function tgJournal_(book) {
  let sheet = book.getSheetByName(TG_CONFIG.journal);
  if (!sheet) sheet = book.insertSheet(TG_CONFIG.journal);
  if (!sheet.getLastRow()) {
    sheet.getRange(1,1,1,TG_CONFIG.header.length).setValues([TG_CONFIG.header]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function tgPut_(sheet, items) {
  if (!items.length) return;
  const last = sheet.getLastRow();
  const ids = new Set(last > 1 ? sheet.getRange(2,1,last-1,1).getValues().map(r => r[0]) : []);
  const rows = [];
  for (const item of items) {
    if (ids.has(item.id)) continue;
    ids.add(item.id);
    rows.push([item.id,item.label,item.title,item.url,item.contextMatch ? '목록 일치' : '', '대기','','']);
  }
  if (!rows.length) return;
  const safe = rows.map(row => row.map(v => typeof v === 'string' && /^[=+@-]/.test(v) ? "'" + v : v));
  sheet.getRange(last+1,1,safe.length,8).setValues(safe);
  SpreadsheetApp.flush(); // The queue must be durable before advancing a source's seen IDs.
}

function tgLocalTime_(value) {
  if (value instanceof Date) return value.getTime();
  const m = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2})(:\d{2}:\d{2})$/);
  return m ? Date.parse(m[1]+'T'+m[2].padStart(2,'0')+m[3]+'+09:00') : NaN;
}

function tgItem_(id, title, url, alreadyMatched) {
  const source = TRIAL.sources.find(s => s[0] === String(id).split(':')[0]);
  if (!source) return null;
  // Both historical spreadsheet rows and GitHub state are untrusted data. Only
  // construct canonical official URLs from known source keys and numeric IDs.
  const canonical = tgCanonical_(source, id);
  if (!canonical || !title || !url) return null;
  return {id, label:source[1], title:String(title).replace(/\s+/g,' ').trim(), url:canonical, contextMatch:alreadyMatched};
}

function tgCanonical_(source, id) {
  const parts = String(id).split(':').slice(1);
  if (parts.length !== (source[3] === 'sanction' ? 2 : 1) || !parts.every(p => /^\d+$/.test(p))) return '';
  const base=source[2], n=parts[0];
  switch (source[3]) {
    case 'fsc': return base+'/'+n;
    case 'fsc_rules': return base+'/view?noticeId='+n;
    case 'fss': return base.replace('/list.do?', '/view.do?nttId='+n+'&');
    case 'sanction': return base.replace('list.do','view.do')+'&examMgmtNo='+n+'&emOpenSeq='+parts[1];
    default: return base.replace('list.do','view.do')+'&lrgSlno='+n;
  }
}

// Only this transition consults GitHub. Live delivery is independent of GitHub.
function tgHandoff_(props, book) {
  const workflow = tgGithub_(TG_CONFIG.workflow);
  if (!['disabled_manually','disabled_inactivity'].includes(workflow.state)) {
    tgStatus_(book,'전환 준비 완료 — GitHub 중지 대기');
    return false;
  }
  const recent = tgGithub_(TG_CONFIG.workflow+'/runs?branch=main&per_page=100');
  if (!Array.isArray(recent.workflow_runs)) throw new Error('GitHub 실행 상태를 확인할 수 없습니다.');
  if (recent.workflow_runs.some(run => run.status !== 'completed')) {
    tgStatus_(book,'전환 대기 — 마지막 GitHub 작업이 끝나기를 기다립니다.');
    return false;
  }
  const state = tgSnapshot_();
  const items = [];
  const armed = Number(props.getProperty('TG_ARMED_AT'));
  const cutoffs = {};
  const seeds = {};
  for (const source of TRIAL.sources) {
    const key = source[0];
    cutoffs[key] = Math.min(armed, Date.parse(state.sources[key].last_success)) - 300000;
    const githubIds = Object.keys(state.seen).filter(id => id.startsWith(key+':'));
    const trialIds = JSON.parse(props.getProperty('SEEN_'+key) || '[]');
    // Give the trial's most recent observations priority within the per-source limit.
    const seed = [...new Set(githubIds.filter(id=>!trialIds.includes(id)).concat(trialIds))].slice(-200);
    if (!seed.length) throw new Error(source[1]+'의 기존 점검 기록을 확인할 수 없습니다.');
    seeds['TG_KNOWN_'+key] = JSON.stringify(seed);
  }
  const discovered = book.getSheetByName('신규자료');
  const last = discovered.getLastRow();
  if (last > 1) {
    for (const row of discovered.getRange(2,1,last-1,5).getValues()) {
      const id = String(row[2]), key = id.split(':')[0];
      if (state.seen[id] || (state.notifications || {})[id] || !(tgLocalTime_(row[0]) >= cutoffs[key])) continue;
      const item = tgItem_(id,row[3],row[4],false);
      if (item) items.push(item);
    }
  }
  for (const [id, pending] of Object.entries(state.pending || {})) {
    if (state.seen[id] === 'sent' || (state.notifications || {})[id]) continue;
    const item = tgItem_(id,pending.title,pending.url,true);
    if (item) items.push(item);
  }
  tgPut_(tgJournal_(book),items);
  props.setProperties(seeds,false);
  props.setProperty('TG_MODE','live');
  tgStatus_(book,'Google 텔레그램 발송 중');
  return true;
}

function telegramTick_(manual) {
  const started = new Date();
  const day = activeHours_(started);
  if (!day && !manual) return;
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TG_MODE')) { runProbe_(manual); return; }
  if (!day) { console.log('정기 발송 시간은 한국시간 06:00~21:00입니다.'); return; }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1500)) return;
  let shadow = false;
  try {
    const book = SpreadsheetApp.openById(props.getProperty('TRIAL_SHEET_ID'));
    try {
      let mode = props.getProperty('TG_MODE');
      if (mode === 'waiting' && tgHandoff_(props,book)) mode = 'live';
      if (mode === 'live') tgLive_(props,book,started,manual);
      else shadow = true;
    } catch (error) {
      const waiting = props.getProperty('TG_MODE') === 'waiting';
      tgStatus_(book,(waiting ? '전환 대기' : 'Google 발송 점검 필요')+' — '+String(error.message).slice(0,180));
      console.error(String(error.message).slice(0,180));
      shadow = waiting;
    }
  } finally { lock.releaseLock(); }
  if (shadow) runProbe_(manual);
}

function tgMorePages_(source, first, known) {
  // Most polls stop on page one. An overnight burst can span multiple list pages.
  const items = new Map(first.map(item => [item.id,item]));
  let page = first;
  let capped = false;
  for (let number = 2; page.length >= 10 && !known.has(page[page.length-1].id); number++) {
    if (number > 3) { capped = true; break; }
    const param = source[3].startsWith('fsc') ? 'curPage' : 'pageIndex';
    const url = source[2]+(source[2].includes('?') ? '&' : '?')+param+'='+number;
    const r = UrlFetchApp.fetch(url, {muteHttpExceptions:true});
    if (r.getResponseCode() !== 200) throw new Error('추가 목록 HTTP '+r.getResponseCode());
    const html = r.getContentText('UTF-8');
    try { page = parseBoard_(html,source); }
    catch (error) {
      if (/(?:게시물|게시글|자료|데이터|조회\s*결과|검색\s*결과)[이가은는]?\s*(?:없습니다|없음)/.test(plain_(html))) break;
      throw error;
    }
    if (page.every(item => items.has(item.id))) break;
    for (const item of page) items.set(item.id,item);
  }
  return {items:[...items.values()], capped};
}

function tgLive_(props, book, started, manual) {
  const sources = TRIAL.sources, journal = tgJournal_(book);
  const stamps = [], errors = [], newItems = [], sourceRows = [], updates = {};
  let ok = 0, sent = 0;
  const time = kst_(started);
  const previous = Number(props.getProperty('LAST_TIMER_START'));
  const gap = !manual && previous ? (started.getTime()-previous)/60000 : '';
  if (!manual) props.setProperty('LAST_TIMER_START',String(started.getTime()));
  let batch;
  try {
    batch = UrlFetchApp.fetchAll(sources.map(s => ({url:s[2],muteHttpExceptions:true})));
  } catch (ignored) {
    // Apps Script can throw for a single failed host in fetchAll. Recover the other sources
    // on this pass as well. Individual requests never use the Telegram token.
    batch = sources.map(s => {
      try { return UrlFetchApp.fetch(s[2],{muteHttpExceptions:true}); } catch (ignored) { return null; }
    });
  }
  for (let i=0; i<sources.length; i++) {
    const source = sources[i], resp = batch[i], key='TG_KNOWN_'+source[0];
    const status = resp ? resp.getResponseCode() : 0;
    try {
      if (status !== 200) throw new Error('목록 HTTP '+status);
      const known = new Set(JSON.parse(props.getProperty(key) || '[]'));
      if (!known.size) throw new Error('이전 점검 목록을 확인할 수 없습니다.');
      const result = tgMorePages_(source,parseBoard_(resp.getContentText('UTF-8'),source),known);
      const ordered = result.items.reverse();
      const added = ordered.filter(item => !known.has(item.id));
      for (const item of added) {
        const clean = tgItem_(item.id,item.title,item.url,item.contextMatch);
        if (!clean) throw new Error('게시물 식별자를 확인할 수 없습니다.');
        newItems.push(clean);
        stamps.push([time,clean.label,clean.id,clean.title,clean.url,'Google 정식 운영','','','']);
      }
      // Preserve pinned entries currently visible on the board in the bounded set.
      ordered.forEach(item => { known.delete(item.id); known.add(item.id); });
      updates[key] = JSON.stringify([...known].slice(-200));
      const note = result.capped ? '최근 3쪽 점검. 이전 게시물 경계가 없어 더 오래된 자료 확인 필요' : '정상';
      if (result.capped) errors.push(source[0]+' '+note);
      sourceRows.push([time,source[1],status,ordered.length,added.length,note]);
      ok++;
    } catch (error) {
      const message = String(error.message).slice(0,160);
      sourceRows.push([time,source[1],status,0,0,message]); errors.push(source[0]+' '+message);
    }
  }
  tgPut_(journal,newItems);
  append_(book,'신규자료',stamps);
  if (Object.keys(updates).length) props.setProperties(updates,false);
  // Retry prior pending rows even if today's board requests all failed.
  try { sent = tgDrain_(props,journal); } catch (error) { errors.push(String(error.message).slice(0,160)); }
  const fail = sources.length-ok;
  const overnight = previous && kst_(new Date(previous)).slice(0,10) !== time.slice(0,10);
  append_(book,'기관별점검',sourceRows);
  append_(book,'실행기록',[[time,manual?'수동':'자동',gap,overnight?'야간 이후':'주간',
    (Date.now()-started.getTime())/1000,ok,fail,newItems.length,errors.join(' / ')]]);
  book.getSheetByName('요약').getRange(6,1,6,2).setValues([
    ['최근 점검',time],['최근 자동 실행 간격(분)',gap],['최근 수집 성공 / 실패',ok+' / '+fail],
    ['최근 신규 자료',newItems.length],['이번 텔레그램 발송',sent],['버전',TRIAL.version]
  ]);
  tgStatus_(book,errors.length ? 'Google 발송 중 — '+errors.join(' / ').slice(0,160) : 'Google 텔레그램 발송 중');
}

function tgArticleText_(html) {
  // Only the article containers used by the agency sites. Navigation mentions
  // insurance on unrelated pages. Keep nested paragraph/div content intact.
  const safe = String(html).replace(/<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/gi,' ');
  const tags = /<(\/?)([a-z][\w:-]*)\b([^>]*)>/gi;
  const target = /(?:^|\s)(?:bbs-view-cont|bdView|cont|krds-bd-view)(?:\s|$)/i;
  let match, tag = '', depth = 0, start = 0;
  const text = [];
  while ((match = tags.exec(safe))) {
    const name = match[2].toLowerCase();
    if (depth) {
      if (name !== tag) continue;
      if (match[1]) depth--;
      else if (!/\/\s*$/.test(match[3])) depth++;
      if (!depth) text.push(plain_(safe.slice(start,match.index)));
    } else if (!match[1] && /^(div|section|article|td|dd|main)$/.test(name) && target.test(attr_(match[3],'class'))) {
      tag = name; depth = 1; start = tags.lastIndex;
    }
  }
  return text.join(' ').trim();
}

function tgMatch_(row) {
  if (row[4] === '목록 일치' || relevant_(String(row[2]))) return {send:true,note:'목록 일치'};
  let body = '';
  try {
    const source = TRIAL.sources.find(s => s[0] === String(row[0]).split(':')[0]);
    const url = source && tgCanonical_(source,row[0]);
    if (!url) throw new Error('게시물 식별자 확인 필요');
    const response = UrlFetchApp.fetch(url,{muteHttpExceptions:true});
    if (response.getResponseCode() === 200) body = tgArticleText_(response.getContentText('UTF-8'));
  } catch (ignored) {}
  // Same conservative policy as the original notifier.
  if (!body) return {send:true,note:'본문 확인이 어려워 누락 방지 발송'};
  const send = relevant_(body);
  return {send,note:send?'본문 일치':'관련 키워드 없음'};
}

function tgDrain_(props, sheet) {
  if (Number(props.getProperty('TG_RETRY_AT')) > Date.now()) return 0;
  const last = sheet.getLastRow();
  const start = Math.max(2,Number(props.getProperty('TG_ROW')) || 2);
  if (start > last) return 0;
  const credentials = tgCredentials_(props);
  const rows = sheet.getRange(start,1,Math.min(12,last-start+1),8).getValues();
  let count = 0;
  for (let i=0; i<rows.length; i++) {
    const n = start+i, row = rows[i];
    if (!activeHours_(new Date())) break;
    if (row[5] !== '발송 완료' && row[5] !== '비대상') {
      const result = row[5] === '재시도' ? {send:true,note:'재시도'} : tgMatch_(row);
      if (result.send) {
        const source = TRIAL.sources.find(s => s[0] === String(row[0]).split(':')[0]);
        const url = source && tgCanonical_(source,row[0]);
        if (!url) throw new Error('대기열의 게시물 ID를 확인하세요.');
        if (count) Utilities.sleep(1100);
        const title = String(row[2]).replace(/\s+/g,' ').trim().slice(0,3500);
        try { tgSend_(credentials.token,credentials.chat,'['+source[1]+']\n'+title+'\n'+url); }
        catch (error) {
          if (error.retryAfter) props.setProperty('TG_RETRY_AT',String(Date.now()+error.retryAfter*1000));
          sheet.getRange(n,6,1,3).setValues([['재시도','',String(error.message).slice(0,160)]]);
          throw error;
        }
        sheet.getRange(n,6,1,3).setValues([['발송 완료',kst_(new Date()),result.note]]);
        count++;
      } else {
        sheet.getRange(n,6,1,3).setValues([['비대상','',result.note]]);
      }
      SpreadsheetApp.flush();
    }
    props.setProperty('TG_ROW',String(n+1));
  }
  return count;
}


