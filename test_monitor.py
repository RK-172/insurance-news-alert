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
if __name__=='__main__':unittest.main()
