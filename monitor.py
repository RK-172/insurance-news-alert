"""Public-source notifier. No AI API, no paid services, no secrets in state/logs."""
import argparse, concurrent.futures, datetime as dt, gzip, json, os, re, time
from pathlib import Path
from urllib.parse import urljoin, urlsplit, parse_qs, urlencode
from urllib.request import Request, urlopen
from lxml import html

SOURCES = [
 ('fsc_press','금융위 보도자료','https://www.fsc.go.kr/no010101','fsc'),
 ('fsc_explain','금융위 보도설명','https://www.fsc.go.kr/no010102','fsc'),
 ('fsc_rules','금융위 입법·규정예고','https://www.fsc.go.kr/po040301','fsc_rules'),
 ('fss_press','금감원 보도자료','https://www.fss.or.kr/fss/bbs/B0000188/list.do?menuNo=200218','fss'),
 ('fss_explain','금감원 보도설명','https://www.fss.or.kr/fss/bbs/B0000189/list.do?menuNo=200219','fss'),
 ('fss_sanction','금감원 검사결과·제재','https://www.fss.or.kr/fss/job/openInfo/list.do?menuNo=200476','sanction'),
 ('fss_rules','금감원 세칙 제·개정 예고','https://www.fss.or.kr/fss/job/lrgRegItnPrvntc/list.do?menuNo=200489','fss_rules'),
]
KEYWORDS = ['보험','생명','손해보험','설계사','계리','지급여력','k-ics','킥스','ifrs17','csm','ga','퇴직연금','해약','금융소비자','소비자보호','소비자 보호','금융회사','내부통제','개인정보','개인 정보','신용정보','생산적 금융','국민성장펀드','금융보안','금융 보안','금융지주','금융복합','자본규제','판매수수료','판매 수수료','금융상품','실손','재보험','예금자보호','금융산업의 구조개선','금융산업구조개선','금산법']

def text(node): return ' '.join(node.text_content().split())
def relevant(value):
    value=value.lower()
    return any((re.search(r'\bga\b',value) if k=='ga' else k in value) for k in KEYWORDS)
def fetch(url):
    # Never include request URLs in errors: API URLs may contain credentials.
    for attempt in range(2):
        try:
            with urlopen(Request(url,headers={'User-Agent':'InsurancePolicyNotifier/1.0 (public documents; low frequency)','Accept-Encoding':'gzip'}),timeout=12) as r:
                data=r.read()
                if r.headers.get('Content-Encoding','').lower()=='gzip':data=gzip.decompress(data)
                return data.decode('utf-8')
        except Exception as exc:
            if attempt==1: raise RuntimeError('HTTP 요청 실패 (2회 시도; '+type(exc).__name__+')') from None
            time.sleep(2**attempt)

DISPLAY_LABELS = {
 'fsc_press':'금융위원회 / 보도자료', 'fsc_explain':'금융위원회 / 보도설명자료',
 'fsc_rules':'금융위원회 / 입법예고·규정변경예고',
 'fss_press':'금융감독원 / 보도자료', 'fss_explain':'금융감독원 / 보도설명자료',
 'fss_sanction':'금융감독원 / 제재정보', 'fss_rules':'금융감독원 / 세칙 제·개정 예고',
}

def format_notification(item):
    label=DISPLAY_LABELS.get(item['id'].split(':')[0],item['label'])
    return '\n'.join([f'[{label}]',item['title'],item['url']])


def parse_board(body, source):
    key,label,base,kind=source
    doc=html.fromstring(body); result={}
    for a in doc.xpath('//a[@href]'):
        href=a.get('href'); query=parse_qs(urlsplit(href).query)
        if kind=='fsc': ok=bool(re.search(r'/'+urlsplit(base).path.strip('/')+r'/\d+',href))
        elif kind=='fsc_rules': ok='/po040301/view' in href and 'noticeId' in query
        elif kind=='fss': ok='/bbs/' in href and '/view.do' in href and 'nttId' in query
        elif kind=='sanction': ok='/job/openInfo/view.do' in href and 'examMgmtNo' in query
        else: ok='/job/lrgRegItnPrvntc/' in href and 'view.do' in href
        if not ok: continue
        title=a.get('title') or text(a)
        row=a
        for parent in a.iterancestors():
            if parent.tag in ('tr','li'): row=parent; break
        rowtext=text(row)
        if kind=='sanction':
            cells=row.xpath('./td'); title=' / '.join(text(c) for c in cells[1:4] if '내용보기' not in text(c))
        if kind=='fsc': ident=re.search(r'/\d+',urlsplit(href).path).group()[1:]; url=urljoin(base,urlsplit(href).path)
        else:
            idkeys={'fsc_rules':['noticeId'],'fss':['nttId'],'sanction':['examMgmtNo','emOpenSeq'],'fss_rules':[]}[kind]
            if not idkeys: idkeys=[k for k in query if k.lower() not in ('menuno','pageindex','sdate','edate','searchcnd','searchwrd')]
            if not idkeys: continue
            ident=':'.join(query.get(k,[''])[0] for k in idkeys)
            clean={k:v[0] for k,v in query.items() if k in idkeys or k=='menuNo'}
            url=urljoin(base,urlsplit(href).path)+'?'+urlencode(clean)
        dates=re.findall(r'20\d{2}[-.]?\d{2}[-.]?\d{2}',rowtext)
        result[key+':'+ident]={'id':key+':'+ident,'title':title,'url':url,'date':dates[0] if dates else '', 'label':label,'context':rowtext}
    if not result: raise RuntimeError('목록 게시물을 찾지 못함: 구조 변경 또는 차단 확인 필요')
    return list(result.values())

def collect(source,pages=3,known_ids=None):
    rows={}
    for page in range(1,pages+1):
        url=source[2]; param='curPage' if source[3].startswith('fsc') else 'pageIndex'
        url+=('&' if '?' in url else '?')+urlencode({param:page})
        page_items=parse_board(fetch(url),source)
        for item in page_items: rows[item['id']]=item
        # Once a known entry is reached, the preceding newest entries cover the gap.
        if known_ids and any(item['id'] in known_ids for item in page_items): break
    return list(rows.values())

def detail_relevant(item):
    if relevant(item['context']): return True
    doc=html.fromstring(fetch(item['url']))
    # Only content area: global navigation mentions insurance on unrelated pages.
    nodes=doc.xpath('//*[contains(concat(" ",normalize-space(@class)," ")," bbs-view-cont ") or contains(concat(" ",normalize-space(@class)," ")," bdView ") or contains(concat(" ",normalize-space(@class)," ")," cont ") or contains(concat(" ",normalize-space(@class)," ")," krds-bd-view ")]')
    if not nodes:
        # Cannot safely classify; notify conservatively instead of dropping a new post.
        return True
    return relevant(' '.join(text(n) for n in nodes))

def telegram(message):
    token=os.environ.get('TELEGRAM_BOT_TOKEN',''); chat=os.environ.get('TELEGRAM_CHAT_ID','')
    if not token or not chat: raise RuntimeError('텔레그램 비밀 설정 2개 필요')
    req=Request('https://api.telegram.org/bot'+token+'/sendMessage',data=urlencode({'chat_id':chat,'text':message[:4000],'disable_web_page_preview':'true'}).encode())
    try:
        with urlopen(req,timeout=25) as r: response=json.load(r)
        if not response.get('ok'): raise ValueError()
    except Exception: raise RuntimeError('텔레그램 전송 실패 (토큰·수신자·봇 시작 확인)') from None

def save(state,path):
    tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(state,ensure_ascii=False,indent=2));tmp.replace(path)

def needs_rules_backfill(item, state):
    # Repair launch-day notices suppressed by initial baseline; sent entries never replay.
    return (item['id'].startswith('fsc_rules:')
            and state['seen'].get(item['id']) == 'baseline'
            and item['date'] >= '2026-11-02'
            and relevant(item['context']))

def collection_due(state, now=None, minimum_seconds=300):
    if state.get('errors'): return True
    value=state.get('checked_at')
    if not value: return True
    try:
        previous=dt.datetime.fromisoformat(value)
        if previous.tzinfo is None: return True
        elapsed=((now or dt.datetime.now(dt.timezone.utc))-previous).total_seconds()
        return elapsed < 0 or elapsed >= minimum_seconds
    except (ValueError,TypeError): return True

def deliver_pending(state, path):
    failures=0
    for ident, entry in list(state.setdefault('pending',{}).items()):
        if state['seen'].get(ident)=='sent':
            state['pending'].pop(ident);save(state,path);continue
        try:
            telegram(entry['message'])
            state['seen'][ident]='sent'
            state.setdefault('notifications',{})[ident]={'sent_at':dt.datetime.now(dt.timezone.utc).isoformat(),'title':entry.get('title',''),'url':entry.get('url','')}
            state['pending'].pop(ident);save(state,path)
        except Exception as exc:
            failures+=1;print('발송 대기 유지: '+str(exc))
    return failures

def output_pending(state):
    count=len(state.get('pending',{}))
    print('발송 대기: '+str(count)+'건')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'],'a') as output: output.write('pending_count='+str(count)+'\n')

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--dry-run',action='store_true')
    p.add_argument('--test-message',action='store_true')
    p.add_argument('--due-only',action='store_true')
    p.add_argument('--scan-only',action='store_true')
    p.add_argument('--send-only',action='store_true')
    args=p.parse_args()
    if args.test_message:
        telegram('보험정책 알림 연결 테스트입니다.');return
    path=Path('state.json')
    state=json.loads(path.read_text()) if path.exists() else {'sources':{},'seen':{},'errors':{}}
    state.setdefault('pending',{})
    if args.send_only:
        failures=deliver_pending(state,path);output_pending(state)
        if failures: raise SystemExit(1)
        return
    if args.due_only and not collection_due(state):
        print('최근 5분 이내 점검 완료: 중복 수집 생략');output_pending(state);return
    started=dt.datetime.now(dt.timezone.utc)
    failures=0
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        jobs={pool.submit(collect,source,3,set(state['seen'])):source for source in SOURCES}
        for future in concurrent.futures.as_completed(jobs):
            source=jobs[future];key,label=source[:2]
            try:
                items=future.result(); fresh=key not in state['sources'];new_count=0
                for item in reversed(items):
                    backfill=needs_rules_backfill(item,state)
                    if item['id'] in state['seen'] and not backfill: continue
                    if fresh:
                        cutoff=(started-dt.timedelta(days=2)).date().isoformat()
                        if not (key=='fsc_rules' and item['date']>=cutoff and relevant(item['context'])):
                            if not args.dry_run:state['seen'][item['id']]='baseline'
                            continue
                    new_count+=1
                    try:matches=detail_relevant(item)
                    except Exception:matches=True
                    if matches:
                        message=format_notification(item)
                        if args.dry_run:print(message)
                        else:
                            state['pending'][item['id']]={'message':message,'title':item['title'],'url':item['url'],'detected_at':dt.datetime.now(dt.timezone.utc).isoformat()}
                            state['seen'][item['id']]='pending'
                    elif not args.dry_run:state['seen'][item['id']]='filtered'
                if not args.dry_run:
                    state['sources'][key]={'last_success':dt.datetime.now(dt.timezone.utc).isoformat(),'count':len(items),'new_count':new_count}
                    previous=state['errors'].pop(key,None)
                    if previous and previous.get('notified'):
                        ident='health:recovered:'+key+':'+started.isoformat()
                        state['pending'][ident]={'message':'[수집 복구] '+label,'title':label,'url':source[2]}
                    save(state,path)
                print(label+': '+str(len(items))+'건 확인, 신규 '+str(new_count)+'건')
            except Exception as exc:
                failures+=1;print(label+': '+str(exc))
                if not args.dry_run:
                    err=state['errors'].setdefault(key,{'count':0,'notified':False});err['count']+=1
                    if err['count']>=3 and not err.get('notified'):
                        ident='health:failed:'+key+':'+started.isoformat()
                        state['pending'][ident]={'message':f'[수집 장애] {label}: 연속 {err["count"]}회 실패. 점검이 필요합니다.','title':label,'url':source[2]}
                        err['notified']=True
                    save(state,path)
    if not args.dry_run:
        state['checked_at']=started.isoformat();state['last_started_at']=started.isoformat()
        state['finished_at']=dt.datetime.now(dt.timezone.utc).isoformat();save(state,path)
        if not args.scan_only:failures+=deliver_pending(state,path)
    output_pending(state)
    print('국회 입법: 아직 미연결')
    if failures:raise SystemExit(1)
if __name__=='__main__':main()
