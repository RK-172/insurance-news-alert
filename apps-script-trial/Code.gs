/** 보험정책 모니터 시험: 텔레그램 발송 없음, Gmail 접근 없음, 유료 API 없음.
 * 1회: setupTrial 실행 및 Google 권한 승인. 중지: stopTrial.
 * 5분 타이머는 runScheduledProbe만 호출. 야간에는 웹 요청/시트 기록 생략.
 */
const TRIAL = {
  version: '2026-11-06-shadow-v1', timezone: 'Asia/Seoul',
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
  keywords: ['보험','생명','설계사','계리','지급여력','k-ics','킥스','ifrs17','csm','퇴직연금','해약','금융소비자','소비자보호','소비자 보호','금융회사','내부통제','개인정보','개인 정보','신용정보','생산적 금융','국민성장펀드','금융보안','금융 보안','금융지주','금융복합','자본규제','판매수수료','판매 수수료','금융상품','실손','재보험','예금자보호','금융산업의 구조개선','금산법']
};

function setupTrial() {
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
function runScheduledProbe() {runProbe_(false);}
function runTrialNow() {runProbe_(true);}
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
    const id=key+':'+ident;items.set(id,{id,title,url,label});
  }
  if(!items.size)throw new Error('목록을 식별하지 못함: 사이트 차단/구조 변경 확인 필요');
  return Array.from(items.values());
}
