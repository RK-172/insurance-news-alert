"""Cheap operating-hours guard. Runs before Python setup or dependency installation."""
import datetime as dt
import os

def active_hours(now=None):
    current=now or dt.datetime.now(dt.timezone.utc)
    korea=current.astimezone(dt.timezone(dt.timedelta(hours=9)))
    return 6 <= korea.hour < 21

if __name__=='__main__':
    active=active_hours()
    print('운영시간: 06:00~21:00 KST' if active else '야간 중단: 수집·발송·의존성 설치 생략')
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'],'a') as f:f.write('active='+str(active).lower()+'\n')
