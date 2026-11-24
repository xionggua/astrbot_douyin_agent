"""Behavior checks for cross-channel history and native group event boundaries."""
import asyncio
import copy
import json
import sys
import time
from pathlib import Path
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, Mock

sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from astrbot_douyin_agent.conversation_context import ConversationContext, BrowserError, validate_settings
from astrbot_douyin_agent.bridge import DouyinEvent, DouyinPlatform
from astrbot_douyin_agent.main import MimiDouyinDM


def run(coro):return asyncio.run(coro)


class _FakeRaw(dict):
    def __init__(self, data): super().__init__(copy.deepcopy(data)); self.save_config = Mock()


def _fake_get(raw, key, default=None):
    cur = raw
    for part in key.split('.'):
        if not isinstance(cur, dict) or part not in cur: return default
        cur = cur[part]
    return cur


def _fake_memory(config):
    """可写回的 LivingMemory 桩：_raw_config 支持增删改与 save_config 回读。"""
    raw = _FakeRaw(config)
    cm = NS(_raw_config=raw, get=lambda key, default=None: _fake_get(raw, key, default), _load_config=Mock())
    engine = NS(search_memories=AsyncMock(return_value=[]), add_memory=AsyncMock(return_value=1))
    return NS(config_manager=cm, initializer=NS(memory_engine=engine)), raw


def test_alias_auto_alignment_on_bind_and_unbind():
    # MEMORYALIAS_V1：绑定自动写身份对齐行 + 互通适配器；原生四件套齐备后镜像退场；解绑自动清理。
    async def check():
        owner,source,target,conversation=fixture()
        memory,raw=_fake_memory({'access_control':{'identity_aliases':''},'filtering_settings':{}})
        owner.context.get_registered_star=lambda name:NS(activated=True,star_cls=memory)
        sharing=ConversationContext(owner)
        row=await sharing.save_link({'target_session':target,'target_conversation_id':'selected-qq','share_memory':True})
        assert row['share_memory'] is True
        assert raw['access_control']['identity_aliases']=='mimi-douyin:alice=alice'
        assert raw['filtering_settings']['shared_adapter_ids']==['mimi-douyin','qq']
        assert not row.get('memory_native') and row['memory_note']
        assert 'memory_note' not in owner.config['conversation_links'][-1]
        raw['filtering_settings']['memory_scope_mode']='user'
        raw['filtering_settings']['user_scope_ignore_platform']=True
        assert sharing.native_share_active(source,target)
        event=NS(unified_msg_origin=source,get_message_str=lambda:'今天聊了很多关于旅行计划的事情')
        response=NS(role='assistant',content='你们的旅行计划听起来很棒，记得提前订好住宿。')
        await sharing.mirror_write(event,response)
        memory.initializer.memory_engine.add_memory.assert_not_called()  # 原生互通生效，镜像退场
        sharing.remove_link(source)
        assert 'mimi-douyin:alice' not in raw['access_control']['identity_aliases']
    run(check())


def fixture():
    source='douyin:FriendMessage:alice';target='qq:FriendMessage:alice'
    history=[{'role':'system','content':'must not be copied'},
        {'role':'user','content':'earlier topic'}, {'role':'assistant','content':'earlier answer'},
        {'role':'user','content':'latest topic'}, {'role':'tool','content':'not a chat turn'}]
    conversation=NS(user_id=target,cid='selected-qq',history=json.dumps(history),updated_at=time.time(),title='Existing chat',persona_id=None)
    manager=NS(get_curr_conversation_id=AsyncMock(return_value='selected-qq'),get_conversation=AsyncMock(return_value=conversation),
        get_filtered_conversations=AsyncMock(return_value=([conversation],1)))
    owner=NS(config={'shared_context':{'max_messages':2},'conversation_links':[{'source_session':source,'target_session':target,
        'target_conversation_id':'selected-qq','bidirectional':True,'share_memory':False}]},
        context=NS(conversation_manager=manager,get_registered_star=lambda name:None),_save_config=Mock(),
        binding={'peer':{'key':'alice'}},session_id=lambda:source)
    return owner,source,target,conversation


def test_selected_existing_conversation_and_live_limits():
    async def check():
        owner,source,target,conversation=fixture();sharing=ConversationContext(owner)
        request=NS(extra_user_content_parts=[])
        await sharing.inject(NS(unified_msg_origin=source),request)
        text=request.extra_user_content_parts[0].text
        assert 'latest topic' in text and 'earlier answer' in text and 'earlier topic' not in text and 'must not be copied' not in text
        owner.config['shared_context']={'max_messages':1,'max_chars_per_message':100,'max_age_hours':0,'max_total_chars':1000}
        conversation.history=json.dumps([{'role':'user','content':'x'*160}]);conversation.updated_at=0
        request.extra_user_content_parts=[];await sharing.inject(NS(unified_msg_origin=source),request)
        payload=json.loads(request.extra_user_content_parts[0].text.split('\n')[-1])
        assert payload[0]['conversation'][0]['text']=='x'*100
        owner.config['shared_context']['enabled']=False
        await sharing.inject(NS(unified_msg_origin=source),request)
        assert not request.extra_user_content_parts
        assert conversation.history==json.dumps([{'role':'user','content':'x'*160}])
    run(check())


def test_reverse_link_follows_selected_conversation_only():
    async def check():
        owner,source,target,conversation=fixture();sharing=ConversationContext(owner)
        conversation.user_id=source;conversation.history=json.dumps([{'role':'user','content':'Douyin continuation'}])
        request=NS(extra_user_content_parts=[])
        await sharing.inject(NS(unified_msg_origin=target),request)
        assert 'Douyin continuation' in request.extra_user_content_parts[0].text
        owner.context.conversation_manager.get_curr_conversation_id.return_value='another-qq-dialogue'
        request.extra_user_content_parts=[];await sharing.inject(NS(unified_msg_origin=target),request)
        assert request.extra_user_content_parts==[]
    run(check())


def test_group_private_link_is_rejected_without_mutation():
    async def check():
        owner,source,target,conversation=fixture();sharing=ConversationContext(owner)
        owner.session_id=lambda:'douyin:GroupMessage:group-one'
        before=copy.deepcopy(owner.config)
        try:await sharing.save_link({'target_session':target,'target_conversation_id':'selected-qq'});assert False
        except BrowserError:pass
        assert owner.config==before;owner._save_config.assert_not_called()
        owner.session_id=lambda:source
        # MEMORYSKIP_V1：记忆条件不满足时降级为普通关联，不再整体拒绝
        row=await sharing.save_link({'target_session':target,'target_conversation_id':'selected-qq','share_memory':True})
        assert row['share_memory'] is False
        assert row['memory_skipped']
        stored=owner.config['conversation_links'][-1]
        assert stored['share_memory'] is False and 'memory_skipped' not in stored
        row=await sharing.save_link({'target_session':target,'target_conversation_id':'selected-qq','bidirectional':True})
        assert row['target_conversation_id']=='selected-qq'
    run(check())


def test_native_group_members_and_batches_are_separate():
    async def check():
        owner=object.__new__(MimiDouyinDM)
        owner.context=NS(get_event_queue=lambda:asyncio.Queue());owner.config={'group_reply_mode':'所有新消息'}
        owner.platform=DouyinPlatform(owner);owner.job_lock=asyncio.Lock();owner._process_items=AsyncMock()
        owner.ledger=NS(get=lambda key,default=None:default,put=Mock())
        from astrbot_douyin_agent.group_conversation import GroupConversation
        owner.group_conversation=GroupConversation(owner)
        peer={'key':'group-one','name':'Test group','conversation_type':'group','self_user_id':'bot'}
        def item(sender,text):return {'key':sender+text,'sender':'peer','sender_id':sender,'sender_name':sender,'kind':'text','text':text}
        messages=[item('one','a'),item('one','b'),item('two','c')]
        await owner._handle(messages,peer)
        assert [len(call.args[0]) for call in owner._process_items.call_args_list]==[2,1]
        event=DouyinEvent(owner,'job',messages[2:],[],[],peer=peer)
        assert event.get_group_id()=='group-one' and event.get_sender_id()=='two'
        assert event.unified_msg_origin=='mimi-douyin:GroupMessage:group-one'
        private=DouyinEvent(owner,'private',[item('one','a')],[],[],peer={'key':'one','name':'Private'})
        assert private.unified_msg_origin=='mimi-douyin:FriendMessage:one'
        owner._process_items.reset_mock();owner.config['group_reply_mode']='仅@机器人';owner.config['group_mention_names']=['TestBot']
        await owner._handle([item('one','ordinary conversation')],peer);owner._process_items.assert_not_called()
        await owner._handle([item('one','@TestBot hello')],peer);assert owner._process_items.await_count==1
    run(check())


def test_invalid_context_limits_are_rejected():
    for value in (0,-1,101,True,'wrong'):
        try:validate_settings({'max_messages':value});assert False
        except BrowserError:pass
    assert validate_settings({'max_age_hours':'0'})['max_age_hours']==0


def test_private_round_is_mirrored_into_linked_qq_memory():
    # MEMORYWRITE_V1：抖音私聊轮次镜像写入关联 QQ 会话（add_memory），QQ 端原生检索可召回；
    # 过短轮次与群聊会话不写入（群聊保持只读设计）。
    async def check():
        owner,source,target,conversation=fixture()
        engine=NS(search_memories=AsyncMock(return_value=[]),add_memory=AsyncMock(return_value=1))
        memory=NS(config_manager=NS(get=lambda key,default='':default),initializer=NS(memory_engine=engine))
        owner.context.get_registered_star=lambda name:NS(activated=True,star_cls=memory)
        owner.context.persona_manager=NS(get_default_persona_v3=AsyncMock(return_value={'name':'Default'}))
        sharing=ConversationContext(owner)
        row=await sharing.save_link({'target_session':target,'target_conversation_id':'selected-qq','share_memory':True})
        assert row['share_memory'] is True
        event=NS(unified_msg_origin=source,get_message_str=lambda:'我们今天去看了海边的日落')
        response=NS(role='assistant',content='听起来很浪漫，海边的日落总是让人放松。')
        await sharing.mirror_write(event,response)
        assert engine.add_memory.await_count==1
        kwargs=engine.add_memory.call_args.kwargs
        assert kwargs['session_id']==target
        assert kwargs['metadata']['adapter_id']=='qq'
        assert kwargs['persona_id']=='Default'
        assert '海边的日落' in kwargs['content']
        await sharing.mirror_write(NS(unified_msg_origin=source,get_message_str=lambda:'嗯'),NS(role='assistant',content='好'))
        assert engine.add_memory.await_count==1  # 过短轮次不写入
        await sharing.mirror_write(NS(unified_msg_origin='douyin:GroupMessage:g1',get_message_str=lambda:'群里的这条消息足够长不会触发过短保护'),NS(role='assistant',content='回复内容也足够长不会触发过短保护'))
        assert engine.add_memory.await_count==1  # 群聊只读不写
    run(check())


def test_private_link_memory_is_read_only_recall_without_livingmemory_config():
    # MEMORYREAD_V2：私聊记忆参考与群聊同款——直调 LivingMemory 检索（只读），
    # 不依赖 LivingMemory 侧任何配置（access_control.shared_private_sessions 在真实 LivingMemory 2.x 中不存在）。
    async def check():
        owner,source,target,conversation=fixture()
        engine=NS(search_memories=AsyncMock(return_value=[NS(content='Private long-term fact')]))
        memory=NS(config_manager=NS(get=lambda key,default='':default),initializer=NS(memory_engine=engine))
        owner.context.get_registered_star=lambda name:NS(activated=True,star_cls=memory)
        owner.context.persona_manager=NS(get_default_persona_v3=AsyncMock(return_value={'name':'Default'}))
        sharing=ConversationContext(owner)
        row=await sharing.save_link({'target_session':target,'target_conversation_id':'selected-qq','share_memory':True})
        assert row['share_memory'] is True and not row['memory_skipped']
        conversation.updated_at=0;owner.config['shared_context']['enabled']=False
        request=NS(extra_user_content_parts=[])
        await sharing.inject(NS(unified_msg_origin=source,get_message_str=lambda:'Remember?'),request)
        assert 'Private long-term fact' in request.extra_user_content_parts[0].text
        assert engine.search_memories.call_args.kwargs['session_id']==target
        engine.search_memories.reset_mock()
        await sharing.inject(NS(unified_msg_origin=target),request)  # 反向不检索记忆
        assert engine.search_memories.assert_not_called() is None
    run(check())


def test_opted_in_group_memory_is_read_only_and_independent_of_recent_range():
    async def check():
        owner,source,target,conversation=fixture()
        source='douyin:GroupMessage:test-group';owner.session_id=lambda:source
        engine=NS(search_memories=AsyncMock(return_value=[NS(content='Long-term shared fact')]))
        memory=NS(config_manager=NS(get=lambda key,default='':default),initializer=NS(memory_engine=engine))
        owner.context.get_registered_star=lambda name:NS(activated=True,star_cls=memory)
        owner.context.persona_manager=NS(get_default_persona_v3=AsyncMock(return_value={'name':'Default'}))
        owner.config['group_share_qq_memory']=True
        sharing=ConversationContext(owner)
        row=await sharing.save_link({'target_session':target,'target_conversation_id':'selected-qq','share_memory':True,'bidirectional':True})
        assert not row['bidirectional']  # Private material is never linked back to group members.
        conversation.updated_at=0;owner.config['shared_context']['enabled']=False
        request=NS(extra_user_content_parts=[])
        await sharing.inject(NS(unified_msg_origin=source,get_message_str=lambda:'Remember our topic?'),request)
        assert 'Long-term shared fact' in request.extra_user_content_parts[0].text
        assert 'latest topic' not in request.extra_user_content_parts[0].text
        assert engine.search_memories.call_args.kwargs['session_id']==target
        assert engine.search_memories.call_args.kwargs['persona_id']=='Default'
        engine.search_memories.reset_mock();owner.config['group_share_qq_memory']=False
        await sharing.inject(NS(unified_msg_origin=source),request)
        assert not request.extra_user_content_parts;engine.search_memories.assert_not_called()
    run(check())


def test_legacy_video_recall_survives_context_replacement():
    async def check():
        from astrbot_douyin_agent.conversation_context import LEGACY_MARKER
        owner,source,target,conversation=fixture();sharing=ConversationContext(owner)
        legacy=NS(text=LEGACY_MARKER+'\n'+json.dumps([{'channel':'抖音观看回忆','videos':['Previously watched video fact']}]))
        request=NS(extra_user_content_parts=[legacy,NS(text='Unrelated recalled memory')])
        await sharing.inject(NS(unified_msg_origin=source),request)
        assert len(request.extra_user_content_parts)==2
        assert request.extra_user_content_parts[0].text=='Unrelated recalled memory'
        assert 'Previously watched video fact' in request.extra_user_content_parts[1].text
    run(check())


def test_native_message_ids_survive_read_receipt_changes():
    import tempfile
    from astrbot_douyin_agent.bridge import Ledger
    with tempfile.TemporaryDirectory() as directory:
        ledger=Ledger(Path(directory)/'messages.db')
        previous=[{'native_id':'human-one','fingerprint':'human-text','sender':'peer'},
            {'native_id':'bot-one','fingerprint':'bot-unread','sender':'me'}]
        assert not ledger.observe('group',previous,prime=True)
        current=[previous[0],{**previous[1],'fingerprint':'bot-read'},
            {'native_id':'human-two','fingerprint':'new-text','sender':'peer'}]
        assert ledger.observe('group',current)==[current[-1]]
        assert not ledger.observe('group',current)
        ledger.close()


def test_observed_account_name_and_mention_reach_model_without_persona_edit():
    async def check():
        from astrbot_douyin_agent.bridge import add_channel_identity
        owner=object.__new__(MimiDouyinDM);state={}
        owner.config={};owner.ledger=NS(get=state.get,put=state.__setitem__)
        owner.context=NS(get_event_queue=lambda:asyncio.Queue());owner.platform=DouyinPlatform(owner)
        peer=owner.with_account_identity({'key':'group','conversation_type':'group','name':'Example group','self_user_id':'999','self_user_name':'ChannelBot'})
        items=[{'key':'one','kind':'text','sender_id':'111','sender_name':'Member','text':'@ChannelBot hello'}]
        event=DouyinEvent(owner,'test',items,[],[],peer=peer);request=NS(extra_user_content_parts=[])
        add_channel_identity(event,request)
        assert event.message_obj.raw_message['mentioned_self'] is True
        assert 'ChannelBot' in request.extra_user_content_parts[0].text
        private=owner.with_account_identity({'key':'private','name':'Member','self_user_id':'999'})
        assert private['self_user_name']=='ChannelBot'
        assert not owner.with_account_identity({'key':'other','self_user_id':'different-account'})['self_user_name']
        assert owner.config=={}  # Neither account discovery nor mention data rewrites a persona/config.
    run(check())


if __name__=='__main__':
    for name,check in list(globals().items()):
        if name.startswith('test_') and callable(check):
            check();print('PASS',name)
