"""Grounded browsing and comment receipts shared by both entry points."""
import asyncio
import hashlib
import time
from urllib.parse import urlsplit
from .errors import BrowserError
from .media import prepare_video
from .perception import transcribe_video

class ActivityEngine:
    def __init__(self,owner,perceive=transcribe_video):
        self.owner=owner;self.perceive=perceive;self.lock=asyncio.Lock()

    async def watch(self,url='',prefer_images=False,info_only=False,allow_truncate=False):
        if url: allow_truncate=True # POINTWATCH_V1：点名/分享视频不按时长skip，超长走截断链（feed随机刷才skip换条）
        async with self.lock:
            owner=self.owner
            seen=[key.split(':',1)[1] for (key,) in owner.ledger.db.execute("SELECT key FROM state WHERE key LIKE 'activity:%'").fetchall()]
            limit=int(owner.config.get('max_video_duration_seconds',180))
            seen.extend(key.rsplit(':',1)[1] for (key,) in owner.ledger.db.execute(
                "SELECT key FROM state WHERE key LIKE ?",(f'activity_skip:{limit}:%',)).fetchall())
            source=await owner.browser.call('browse',{'url':url,'allow_truncate':bool(allow_truncate),'seen_ids':seen[-100:],
                'prefer_images':prefer_images,'info_only':info_only},timeout=(600 if allow_truncate else 180))
            if info_only:return {'source':source}
            if source.get('state')=='skipped':
                if source.get('post_id'):
                    owner.ledger.put(f"activity_skip:{source.get('max_duration_seconds',limit)}:{source['post_id']}",
                        {'reason':source.get('reason'),'duration':source.get('duration'),'skipped_at':time.time()})
                return {'skipped':True,'source':source}
            if source.get('path'):
                source['path']=await prepare_video(source['path'],owner.media_dir,owner.ffmpeg_binary,
                    min(float(owner.config.get('max_model_video_mb',18)),14.0),expected_duration=(None if source.get('truncated') else source.get('duration')),ffprobe_binary=owner.ffprobe_binary,max_seconds=(limit if source.get('truncated') else None))
            source['url']=source.pop('source','')
            source['origin']='self_browse'
            transcript=await self.perceive(owner,[source])
            record={'verified':True,'post_id':source.get('post_id'),'url':source['url'],'kind':source.get('kind','video'),'truncated':bool(source.get('truncated')),
                    'transcript':transcript,'watched_at':time.time(),'persona_scope':getattr(owner,'persona',None),
                    'owner_scope':owner.binding['peer']['key'] if getattr(owner,'binding',None) else None}
            if not record['post_id']:raise BrowserError('没有确认作品标识，未登记观看记录。')
            owner.ledger.put('activity:'+record['post_id'],record)
            try:owner.ledger.watch_log_add(record['post_id'],url=record['url'],transcript=record['transcript'],summary=str(record['transcript'] or '')[:120],decision='watched') # WATCHLOG_V1
            except Exception:pass
            comments_receipt=None # WATCHCOMMENTS_V1：读评论与看视频同页（VSESS 复用），失败不阻断转述
            try:
                comments_receipt=await owner.browser.call('read_comments',{'url':source['url'],'limit':10},timeout=120)
            except Exception:
                comments_receipt={'state':'error','reason':'评论读取失败，不影响视频转述。'}
            return {'record':record,'source':source,'comments':comments_receipt}

    async def like(self,url): # LIKEREAD_V1
        async with self.lock:
            return await self._like(url)

    async def _like(self,url):
        import re,time
        from urllib.parse import urlsplit
        owner=self.owner
        if not owner.config.get('allow_likes',False):raise BrowserError('点赞开关未开启。')
        post_id=re.search(r'/(?:video|note)/(\d{12,24})',urlsplit(url).path)
        parsed=urlsplit(url)
        if (parsed.scheme!='https' or not (parsed.hostname=='douyin.com' or str(parsed.hostname).endswith('.douyin.com'))
                or parsed.username or parsed.password or not post_id):
            raise BrowserError('请提供有效的抖音作品链接。')
        record=owner.ledger.get('activity:'+post_id[1])
        if not record or record.get('verified') is not True:
            raise BrowserError('先实际读取这条作品，再根据内容点赞。')
        key='like:'+post_id[1]
        previous=owner.ledger.get(key)
        if previous and previous.get('state')=='liked':return {**previous,'already_liked':True}
        receipt=await owner.browser.call('like',{'url':url},timeout=90)
        owner.ledger.put(key,{**receipt,'liked_at':time.time()})
        try:owner.ledger.watch_log_mark(post_id[1],'liked') # WATCHLOG_V1
        except Exception:pass
        return receipt

    async def read_comments(self,url,limit=10): # LIKEREAD_V1
        import re
        from urllib.parse import urlsplit
        async with self.lock:
            owner=self.owner
            post_id=re.search(r'/(?:video|note)/(\d{12,24})',urlsplit(url).path)
            parsed=urlsplit(url)
            if (parsed.scheme!='https' or not (parsed.hostname=='douyin.com' or str(parsed.hostname).endswith('.douyin.com'))
                    or parsed.username or parsed.password or not post_id):
                raise BrowserError('请提供有效的抖音作品链接。')
            record=owner.ledger.get('activity:'+post_id[1])
            if not record or record.get('verified') is not True:
                raise BrowserError('先实际读取这条作品，再读取评论。')
            limit=max(1,min(int(limit),20))
            return await owner.browser.call('read_comments',{'url':url,'limit':limit},timeout=120)

    async def share(self,url,peer=None): # SHARECARD_V1
        import re,time
        from urllib.parse import urlsplit
        async with self.lock:
            owner=self.owner
            post_id=re.search(r'/(?:video|note)/(\d{12,24})',urlsplit(url).path)
            parsed=urlsplit(url)
            if (parsed.scheme!='https' or not (parsed.hostname=='douyin.com' or str(parsed.hostname).endswith('.douyin.com'))
                    or parsed.username or parsed.password or not post_id):
                raise BrowserError('请提供有效的抖音作品链接。')
            record=owner.ledger.get('activity:'+post_id[1])
            if not record or record.get('verified') is not True:
                raise BrowserError('先实际读取这条作品，再分享。')
            peer_name=str(peer or '').strip() or str(((owner.binding or {}).get('peer') or {}).get('name') or '').strip()
            if not peer_name:raise BrowserError('未找到私信对象名，无法分享卡片。')
            key='share:'+post_id[1]
            previous=owner.ledger.get(key)
            if previous and previous.get('state')=='shared':return {**previous,'already_shared':True}
            receipt=await owner.browser.call('share_card',{'url':url,'peer':peer_name},timeout=120)
            owner.ledger.put(key,{**receipt,'peer':peer_name,'shared_at':time.time()})
            try:owner.ledger.watch_log_mark(post_id[1],'shared') # WATCHLOG_V1
            except Exception:pass
            return receipt

    async def browse_until_share(self,owner,max_videos=12,max_minutes=20): # BROWSE2SHARE_V1：刷到值得分享的才停手；用户来消息视为完成
        import time as _t
        from .perception import judge_share
        start=_t.monotonic();watched=0;liked=0
        profile='' # PROFILE_V1：轮前取一次画像，整轮 judge 复用
        try:
            from .perception import _judge_profile
            profile=await _judge_profile(owner)
        except Exception as exc:
            print('[b2s] judge画像获取失败 '+type(exc).__name__+':'+str(exc)[:120],flush=True)
        for _ in range(int(max_videos)):
            if _t.monotonic()-start>max_minutes*60:
                return {'shared':None,'reason':'budget','watched':watched,'liked':liked}
            try: # 中断检测：观察聊天页，有新用户消息就停手（消息由 inbox 接住，锁释放后正常处理）
                snapshot=await owner.browser.call('snapshot')
                if owner._capture(snapshot) or owner.inbox.next():
                    return {'shared':None,'interrupted':True,'watched':watched,'liked':liked}
            except Exception:
                pass
            try:
                result=await self.watch()
            except Exception as exc: # JUDGEFIX_V1：单条失败（VL间歇故障等）跳过继续，不弃轮
                print('[b2s] 单条观看失败跳过:'+type(exc).__name__+':'+str(exc)[:150])
                continue
            if result.get('skipped'):continue
            watched+=1
            record=result['record']
            decision=await judge_share(owner,record.get('transcript'),profile)
            try:owner.ledger.watch_log_mark(record['post_id'],decision.get('decision','watched'),summary=decision.get('reason'))
            except Exception:pass
            if decision.get('decision')=='share':
                try:
                    receipt=await self.share(record['url'])
                    if receipt.get('state')=='shared' or receipt.get('already_shared'):
                        return {'shared':{**record,'judge_reason':decision.get('reason','')},'watched':watched,'liked':liked}
                except Exception:
                    continue
            elif decision.get('decision')=='like' and owner.config.get('allow_likes',False):
                try:
                    await self.like(record['url']);liked+=1
                except Exception:pass
        return {'shared':None,'reason':'exhausted','watched':watched,'liked':liked}

    async def comment(self,url,text):
        async with self.lock:
            return await self._comment(url,text)

    async def _comment(self,url,text):
        owner=self.owner
        if not owner.config.get('allow_public_comments',False):raise BrowserError('评论开关未开启。')
        import re
        post_id=re.search(r'/(?:video|note)/(\d{12,24})',urlsplit(url).path)
        parsed=urlsplit(url);record=owner.ledger.get('activity:'+post_id[1]) if post_id else None
        if (parsed.scheme!='https' or not (parsed.hostname=='douyin.com' or str(parsed.hostname).endswith('.douyin.com'))
                or parsed.username or parsed.password or not record or record.get('verified') is not True):
            raise BrowserError('先实际读取这条作品，再根据内容评论。')
        text=str(text).strip()
        if not text or len(text)>200:raise BrowserError('评论正文应为 1～200 字。')
        key='comment:'+post_id[1]+':'+hashlib.sha256(text.encode()).hexdigest()
        previous=owner.ledger.get(key)
        if previous:return {**previous,'already_submitted':True}
        owner.ledger.put(key,{'state':'unknown','post_id':post_id[1],'text':text,'submitted_at':time.time()})
        try:receipt=await owner.browser.call('comment',{'url':url,'text':text},timeout=90)
        except Exception:
            # A timeout can occur after the site accepted a comment. Keep the
            # unknown marker so the same text is never submitted automatically.
            raise
        if receipt.get('state') == 'sent' and not receipt.get('comment_id'):
            receipt = {**receipt, 'state': 'unknown', 'reason': 'missing_comment_id'}
        owner.ledger.put(key,{**receipt,'text':text,'submitted_at':time.time()})
        return receipt
