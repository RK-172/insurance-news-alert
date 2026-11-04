import unittest
from unittest.mock import patch
import monitor
class Tests(unittest.TestCase):
 def test_sanction_identity_ignores_pagination(self):
  template='<table><tr><td>1</td><td>테스트생명</td><td>20261102</td><td><a href="/fss/job/openInfo/view.do?menuNo=200476&amp;examMgmtNo=123&amp;emOpenSeq=2&amp;pageIndex={}">내용보기</a></td></tr></table>'
  a=monitor.parse_board(template.format(1),monitor.SOURCES[5]);b=monitor.parse_board(template.format(2),monitor.SOURCES[5]);self.assertEqual(a,b);self.assertIn('테스트생명',a[0]['title'])
 def test_fsc_identity_and_title(self):
  a=monitor.parse_board('<li><a href="/no010101/123?curPage=2" title="보험 제도">링크</a>2026-11-02</li>',monitor.SOURCES[0])[0]
  self.assertEqual(a['id'],'fsc_press:123');self.assertEqual(a['date'],'2026-11-02')
 def test_empty_board_is_error(self):
  with self.assertRaises(RuntimeError):monitor.parse_board('<html>점검 중</html>',monitor.SOURCES[0])
 def test_navigation_not_used_for_classification(self):
  with patch.object(monitor,'fetch',return_value='<nav>보험</nav><div class="cont">가상자산 사업자 해킹</div>'):
   self.assertFalse(monitor.detail_relevant({'context':'가상자산','url':'unused'}))
 def test_unknown_layout_is_conservative(self):
  with patch.object(monitor,'fetch',return_value='<p>새로운 구조</p>'):
   self.assertTrue(monitor.detail_relevant({'context':'새 소식','url':'unused'}))
 def test_keywords(self):
  self.assertTrue(monitor.relevant('GA 판매수수료'));self.assertFalse(monitor.relevant('legal discussion'))
class RulesRegressionTests(unittest.TestCase):
 def test_common_financial_laws(self):
  for title in ['「예금자보호법」 일부개정법률안 입법예고','「금융산업의 구조개선에 관한 법률」 일부개정법률안 입법예고']:
   self.assertTrue(monitor.relevant(title))
 def test_launch_day_baseline_replayed_only_once(self):
  item={'id':'fsc_rules:4188','date':'2026-11-02','context':'예금자보호법'}
  state={'seen':{item['id']:'baseline'}}
  self.assertTrue(monitor.needs_rules_backfill(item,state))
  state['seen'][item['id']]='sent'
  self.assertFalse(monitor.needs_rules_backfill(item,state))
 def test_old_unrelated_and_other_sources_not_replayed(self):
  for key,date,context in [('fsc_rules:1','2026-10-01','보험'),('fsc_rules:2','2026-11-02','한국산업은행법'),('fsc_press:3','2026-11-02','보험')]:
   item={'id':key,'date':date,'context':context}
   self.assertFalse(monitor.needs_rules_backfill(item,{'seen':{key:'baseline'}}))
class MessageTests(unittest.TestCase):
 def item(self):return {'id':'fss_press:1','label':'금감원 보도자료','title':'퇴직연금 캠페인','url':'https://www.fss.or.kr/article'}
 def test_clean_three_line_notice(self):
  message=monitor.format_notification(self.item())
  self.assertEqual(message,'[금융감독원 / 보도자료]\n퇴직연금 캠페인\nhttps://www.fss.or.kr/article')
  self.assertEqual(len(message.splitlines()),3)
  self.assertNotIn('첨부파일',message);self.assertNotIn('등록일',message);self.assertNotIn('※',message)
 def test_attachments_exclude_viewers_and_duplicates(self):
  node=monitor.html.fromstring('<div><a href="/fss/cmmn/file/fileDown.do?fileSn=1">자료.pdf</a><a href="/fss/cmmn/file/fileDown.do?fileSn=1">중복.pdf</a><a href="/viewer">뷰어</a></div>')
  files=monitor.extract_attachments(node,'https://www.fss.or.kr')
  self.assertEqual(len(files),1);self.assertEqual(files[0]['name'],'자료.pdf')
class SchedulingTests(unittest.TestCase):
 def test_gate_uses_elapsed_time_not_rounded_clock(self):
  now=monitor.dt.datetime(2026,11,4,7,0,tzinfo=monitor.dt.timezone.utc)
  self.assertFalse(monitor.collection_due({'checked_at':'2026-11-04T06:46:00+00:00'},now))
  self.assertTrue(monitor.collection_due({'checked_at':'2026-11-04T06:45:00+00:00'},now))
 def test_failed_sources_retry_without_waiting(self):
  now=monitor.dt.datetime(2026,11,4,7,0,tzinfo=monitor.dt.timezone.utc)
  self.assertTrue(monitor.collection_due({'checked_at':now.isoformat(),'errors':{'fsc_press':{'count':1}}},now))
 def test_missing_invalid_and_future_time_do_not_block(self):
  now=monitor.dt.datetime(2026,11,4,7,0,tzinfo=monitor.dt.timezone.utc)
  for value in [None,'bad','2026-11-04T07:01:00+00:00','2026-11-04T07:00:00']:
   self.assertTrue(monitor.collection_due({'checked_at':value},now))
 def test_pagination_stops_at_known_id_and_keeps_new(self):
  old={'id':'fsc_press:old'};new={'id':'fsc_press:new'}
  with patch.object(monitor,'fetch',return_value='unused') as fetch,patch.object(monitor,'parse_board',return_value=[new,old]):
   rows=monitor.collect(monitor.SOURCES[0],known_ids={'fsc_press:old'})
   self.assertEqual(rows,[new,old]);self.assertEqual(fetch.call_count,1)
if __name__=='__main__':unittest.main()

