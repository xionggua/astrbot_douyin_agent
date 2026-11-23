"""RUNINTEG_V2：主动消息插件（astrbot_plugin_proactive_chat）运行时集成注入。

不修改 proactive 任何源码，安装顺序无关。V2 修正：AstrBot 插件加载器
不把插件注册为标准顶层包（import_module 报 No module named），改为从
star 注册表反查真实模块名推导包名，子模块先查 sys.modules 再兜底 import。
"""
from __future__ import annotations

import asyncio
import importlib
import sys
import time

from astrbot.api import logger

PKG = 'astrbot_plugin_proactive_chat'
DOUYIN_TOOLS = ('douyin_watch_recommended',)

_state = {'patched': False, 'loop_task': None, 'pkg': None}

# ------------------------------------------------------------------
# 数据层（原 proactive core/activity_content.py 迁移，自包含）
# ------------------------------------------------------------------
_recent = {}
_last_activity = {}


def sync_douyin_receipt(session_id, record):
    if not isinstance(record, dict):
        return False
    _recent[session_id] = {'record': record, 'ts': time.time()}
    return True


def get_douyin_material(session_id, max_age_seconds=1800):
    item = _recent.get(session_id)
    if not item or time.time() - item['ts'] > max_age_seconds:
        return None
    return _format_record(item['record'])


def available_tools():
    return DOUYIN_TOOLS


def _format_record(record):
    parts = []
    title = str(record.get('title') or record.get('desc') or '').strip()
    if title:
        parts.append('标题：' + title[:80])
    author = record.get('author')
    if isinstance(author, dict):
        author = author.get('name') or author.get('nickname')
    author = str(author or record.get('author_name') or '').strip()
    if author:
        parts.append('作者：' + author[:40])
    transcript = str(record.get('transcript') or record.get('summary') or '').strip()
    if transcript:
        parts.append('内容转述：' + transcript[:600])
    url = str(record.get('url') or record.get('share_url') or '').strip()
    if url:
        parts.append('链接：' + url[:200])
    if not parts:
        for key, value in record.items():
            if isinstance(value, str) and value.strip():
                parts.append(str(key) + '：' + value.strip()[:120])
    return chr(10).join(parts)


def note_proactive_activity(session_id):
    _last_activity[session_id] = time.time()


def find_recent_collision(session_id, window_seconds=600):
    now = time.time()
    for sid, ts in _last_activity.items():
        if sid != session_id and now - ts < window_seconds:
            return sid
    return None


# ------------------------------------------------------------------
# 包名解析：从 star 注册表反查真实模块名（AstrBot 非标准加载兼容）
# ------------------------------------------------------------------
def _resolve_pkg(owner):
    if owner is None:
        return None
    try:
        star = owner.context.get_registered_star(PKG)
        if not (star and star.activated and star.star_cls):
            return None
        mod_name = str(star.star_cls.__class__.__module__)
        if mod_name not in sys.modules:
            return None
        return mod_name.rsplit('.', 1)[0] if '.' in mod_name else mod_name
    except Exception:
        return None


# ------------------------------------------------------------------
# Stage / Feature 类工厂（运行时绑定 proactive 内部类型）
# ------------------------------------------------------------------
def _make_classes(pkg):
    domain_enums = importlib.import_module(pkg + '.core.domain.domain_enums')
    stage_protocol = importlib.import_module(pkg + '.core.pipeline.stage_protocol')
    HookPoint = domain_enums.HookPoint
    StageResult = domain_enums.StageResult
    BaseStage = stage_protocol.BaseStage

    async def handle_body(stage, ctx):
        session_id = ctx.session_id
        if not str(session_id).startswith('mimi-douyin'):
            return StageResult.CONTINUE
        note_proactive_activity(session_id) # COLLIDE_V1：只记抖音会话，QQ端不占浏览锁不算撞车
        collide = find_recent_collision(session_id, window_seconds=600)
        if collide:
            logger.info('[主动消息] 其他会话 %s 刚进入主动流程，抖音本轮延后喵。' % collide)
            ctx.abort('douyin_defer_collision')
            return StageResult.RESCHEDULE
        plugin = stage.orchestrator.plugin
        result = None
        try:
            star = plugin.context.get_registered_star('astrbot_douyin_agent')
            if star and star.activated and star.star_cls:
                result = await star.star_cls.control('browse_until_share')
        except Exception as exc:
            logger.warning('[主动消息] 抖音自主浏览未完成，本轮保持沉默喵：%s' % exc)
            result = None
        shared = (result or {}).get('shared') if isinstance(result, dict) else None
        if not isinstance(shared, dict):
            reason = (result or {}).get('reason') if isinstance(result, dict) else None
            interrupted = bool((result or {}).get('interrupted')) if isinstance(result, dict) else False
            watched = (result or {}).get('watched', 0) if isinstance(result, dict) else 0
            liked = (result or {}).get('liked', 0) if isinstance(result, dict) else 0
            note = '用户来消息，视为完成' if interrupted else (reason or '浏览结束')
            logger.info('[主动消息] 本轮刷了 %s 条、点赞 %s 条，无可分享（%s），保持沉默喵。' % (watched, liked, note))
            ctx.abort('douyin_silent_round')
            return StageResult.RESCHEDULE
        sync_douyin_receipt(session_id, shared)
        material = get_douyin_material(session_id)
        if material:
            extra = getattr(ctx, 'extra', None)
            if not isinstance(extra, dict):
                extra = {}
                setattr(ctx, 'extra', extra)
            prev = str(extra.get('platform_context') or '').strip()
            block = (
                '[我刚刚自主刷抖音，把这条视频以卡片分享给了他]' + chr(10)
                + material
                + chr(10) + '（接下来这条主动消息就是分享后的感想：一两句像真人随手发的短评，聊这条视频最打动人的点；不要复述全文，不要报流水账，不要解释自己在执行任务。）'
            )
            extra['platform_context'] = (prev + chr(10) + block).strip() if prev else block
            logger.info('[主动消息] 已分享并注入素材喵（post_id=%s，共刷 %s 条）。' % (shared.get('post_id'), (result or {}).get('watched', 0)))
            return StageResult.CONTINUE
        logger.info('[主动消息] 分享记录无法格式化，本轮保持沉默喵。')
        ctx.abort('douyin_silent_round')
        return StageResult.RESCHEDULE

    class DouyinActivityStage(BaseStage):
        name = 'douyin_activity_stage'
        hook = HookPoint.DELIBERATE
        priority = 5

        def __init__(self, orchestrator):
            self.orchestrator = orchestrator

        async def handle(self, ctx):
            return await handle_body(self, ctx)

    class DouyinActivityFeature:
        name = 'douyin_activity_feature'

        def __init__(self, orchestrator):
            self.orchestrator = orchestrator

        def register(self, registry):
            registry.add_stage(hook=HookPoint.DELIBERATE, stage=DouyinActivityStage(self.orchestrator), priority=5)

    return DouyinActivityFeature


# ------------------------------------------------------------------
# 注入器
# ------------------------------------------------------------------
def _get_module(pkg, tail):
    mod = sys.modules.get(pkg + '.' + tail)
    if mod is not None:
        return mod
    return importlib.import_module(pkg + '.' + tail)


def ensure_proactive_integ(owner=None):
    """检测 proactive 并运行时注入，返回 True 表示注入成功或已生效。"""
    if _state['patched']:
        return True
    pkg = _resolve_pkg(owner)
    if pkg is None and PKG in sys.modules:
        pkg = PKG
    if pkg is None:
        return False  # proactive 未加载：等下一轮巡检
    try:
        fo = _get_module(pkg, 'core.pipeline.flow_orchestrator')
        if getattr(fo, '_douyin_integ_injected', False):
            _state['patched'] = True
            _state['pkg'] = pkg
            return True
        fm = _get_module(pkg, 'core.features.feature_manifest')
        orig = getattr(fm, 'build_default_features', None) or fo.build_default_features
        feature_cls = _make_classes(pkg)

        def patched_build(orchestrator):
            feats = list(orig(orchestrator))
            feats.append(feature_cls(orchestrator))
            return feats

        fo.build_default_features = patched_build
        fo._douyin_integ_injected = True
        if owner is not None:
            try:
                star = owner.context.get_registered_star(PKG)
                orch = getattr(star.star_cls, 'orchestrator', None)
                if orch is not None and getattr(orch, '_runner', None) is not None:
                    orch._runner = None
                    logger.info('[proactive_integ] 已构建的流水线标记重建，下次主动消息运行时重新装配。')
            except Exception:
                pass
        _state['patched'] = True
        _state['pkg'] = pkg
        logger.info('[proactive_integ] 运行时注入成功（真实包名=' + pkg + '）：主动消息流水线已挂载抖音活动 stage。')
        return True
    except Exception as exc:
        logger.warning('[proactive_integ] proactive 结构不符，注入跳过：' + str(exc)[:200])
        return False


def _forget():
    """proactive 热重载后模块换代，清标志重新注入。"""
    _state['patched'] = False


def start_integ_loop(owner):
    """常驻巡检：未注入 30s 重试（覆盖 proactive 后装），注入成功后 5 分钟巡检防模块换代。"""
    if _state.get('loop_task'):
        return

    async def _loop():
        misses = 0
        while True:
            try:
                pkg = _state.get('pkg')
                if pkg is not None:
                    fo = sys.modules.get(pkg + '.core.pipeline.flow_orchestrator')
                    if fo is None or not getattr(fo, '_douyin_integ_injected', False):
                        _forget()
                ok = ensure_proactive_integ(owner)
                if ok:
                    misses = 0
                    await asyncio.sleep(300)
                else:
                    misses += 1
                    if misses <= 2:
                        logger.info('[proactive_integ] 第 ' + str(misses) + ' 轮未检测到已加载的 proactive，稍后重试。')
                    await asyncio.sleep(30 if misses <= 240 else 300)
            except Exception:
                await asyncio.sleep(60)

    try:
        loop = asyncio.get_event_loop()
        _state['loop_task'] = loop.create_task(_loop())
        logger.info('[proactive_integ] 注入巡检循环已启动。')
    except Exception as exc:
        logger.warning('[proactive_integ] 巡检循环启动失败：' + str(exc)[:160])
