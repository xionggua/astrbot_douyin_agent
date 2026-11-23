import unittest
"""Pure-function tests for mimi_douyin.perception: transcript formatting and
VM JSON parsing/degradation paths (historically fragile, previously 0% covered)."""

from astrbot_douyin_agent.mimi_douyin.perception import (
    BrowserError,
    TEXT_MODE,
    _vm_asr_body,
    _vm_response_json,
    _vm_shq,
    _vm_strip_json,
    format_transcript,
    uses_text_transcription,
)


class FormatTranscriptTests(unittest.TestCase):
    def test_summary_only(self):
        assert format_transcript({'summary': '一只猫跳上桌子'}) == '概述：一只猫跳上桌子'

    def test_all_fields(self):
        data = {
            'summary': 'S',
            'post_descriptions': ['文案一', '文案二', ''],
            'key_facts': ['猫跳上桌子', '桌子晃动'],
            'meaning': '猫想引起注意',
            'audio': '有猫叫声',
            'onscreen_text': '标题字样',
            'uncertain': ['画面右下角模糊', '第10秒对白听不清'],
        }
        text = format_transcript(data)
        assert '作品文案：文案一' in text and '作品文案：文案二' in text
        assert '文案一\n' in text  # 空文案被过滤，不产生空行
        assert '画面与事件：\n- 猫跳上桌子\n- 桌子晃动' in text
        assert '含义解释候选（须结合证据）：猫想引起注意' in text
        assert '声音与对白：有猫叫声' in text
        assert '屏幕文字：标题字样' in text
        assert '不确定之处：画面右下角模糊；第10秒对白听不清' in text

    def test_missing_optional_fields_do_not_crash(self):
        text = format_transcript({'summary': '只看了一段'})
        assert text == '概述：只看了一段'


class VmStripJsonTests(unittest.TestCase):
    def test_plain_dict(self):
        assert _vm_strip_json('{"a": 1}') == '{"a": 1}'

    def test_fenced_with_language(self):
        assert _vm_strip_json('```json\n{"a": 1}\n```') == '{"a": 1}'

    def test_fenced_bare(self):
        assert _vm_strip_json('```\n{"a": 1}\n```') == '{"a": 1}'

    def test_prose_around_dict(self):
        assert _vm_strip_json('好的，结果如下：{"a": 1} 以上。') == '{"a": 1}'


class VmResponseJsonTests(unittest.TestCase):
    def test_direct_dict(self):
        payload = {'choices': [{'message': {'content': '{"summary": "hi"}'}}]}
        assert _vm_response_json(payload) == {'summary': 'hi'}

    def test_fenced_dict(self):
        payload = {'choices': [{'message': {'content': '```json\n{"summary": "hi"}\n```'}}]}
        assert _vm_response_json(payload) == {'summary': 'hi'}

    def test_pure_text_degrades_with_marker(self):
        payload = {'choices': [{'message': {'content': '这段视频里有个人在跳舞。'}}]}
        result = _vm_response_json(payload)
        assert result['summary'].startswith('这段视频里有个人在跳舞。')
        assert result['key_facts'] == []
        assert '纯文本降级' in ''.join(result['uncertain'])

    def test_missing_content_raises(self):
        payload = {'choices': []}
        try:
            _vm_response_json(payload)
            raise AssertionError('expected BrowserError')
        except BrowserError:
            pass


class MiscPureTests(unittest.TestCase):
    def test_uses_text_transcription(self):
        assert uses_text_transcription({}) is True
        assert uses_text_transcription({'video_input_mode': TEXT_MODE}) is True
        assert uses_text_transcription({'video_input_mode': '直接交给聊天模型'}) is False

    def test_vm_shq_quotes_single_quotes(self):
        assert _vm_shq("it's") == "'it'\\''s'"


class VmAsrBodyTests(unittest.TestCase):
    """VMASRPROMPT_V1：prompt 必须以 text 部件进入 content（历史上只发音频、指令裸奔）。"""

    def test_prompt_is_first_content_part(self):
        body = _vm_asr_body('qwen-audio', '请转写', 'data:audio/mpeg;base64,QUJD')
        content = body['messages'][0]['content']
        assert content[0] == {'type': 'text', 'text': '请转写'}

    def test_audio_part_has_format(self):
        body = _vm_asr_body('qwen-audio', '请转写', 'data:audio/mpeg;base64,QUJD')
        audio = body['messages'][0]['content'][1]
        assert audio['type'] == 'input_audio'
        assert audio['input_audio']['data'] == 'data:audio/mpeg;base64,QUJD'
        assert audio['input_audio']['format'] == 'mp3'

    def test_model_stringified(self):
        body = _vm_asr_body(12345, 'p', 'd')
        assert body['model'] == '12345'
