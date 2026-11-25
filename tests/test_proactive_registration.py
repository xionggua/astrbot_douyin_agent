"""PROACTIVEREG_V2：主动消息会话随「允许机器人自己刷抖音」开关自动登记/移除。"""
import unittest
from unittest.mock import MagicMock

from mimi_douyin.proactive_integ import sync_proactive_sessions


class FakeConfig(dict):
    pass


class FakeStar:
    def __init__(self, session_list=None, enable=True):
        cls = MagicMock()
        cfg = FakeConfig(friend_settings={'enable': enable,
                                          'session_list': list(session_list or [])})
        cfg.save_config = MagicMock()
        cls.config = cfg
        self.star_cls = cls
        self.activated = True


class Owner:
    def __init__(self, star=None, autonomy=False, umo='', registered=None):
        ctx = MagicMock()
        ctx.get_registered_star = MagicMock(return_value=star)
        self.context = ctx
        cfg = FakeConfig(autonomy_enabled=autonomy,
                         proactive_registered=list(registered or []))
        cfg.save_config = MagicMock()
        self.config = cfg
        self.session_id = MagicMock(return_value=umo)


UMO = 'mimi-douyin:FriendMessage:abc'
QQ = 'napcat:FriendMessage:1456550698'


class SyncChecks(unittest.TestCase):
    def test_switch_on_registers_bound_private_session(self):
        star = FakeStar(session_list=[QQ])
        owner = Owner(star, autonomy=True, umo=UMO)
        self.assertIs(sync_proactive_sessions(owner), True)
        lst = star.star_cls.config['friend_settings']['session_list']
        self.assertEqual(lst, [QQ, UMO])
        self.assertEqual(owner.config['proactive_registered'], [UMO])

    def test_switch_on_without_binding_is_noop(self):
        star = FakeStar(session_list=[QQ])
        owner = Owner(star, autonomy=True, umo='')
        self.assertIsNone(sync_proactive_sessions(owner))
        self.assertEqual(star.star_cls.config['friend_settings']['session_list'], [QQ])

    def test_switch_off_removes_only_our_sessions(self):
        star = FakeStar(session_list=[QQ, UMO])
        owner = Owner(star, autonomy=False, umo=UMO, registered=[UMO])
        self.assertIs(sync_proactive_sessions(owner), True)
        lst = star.star_cls.config['friend_settings']['session_list']
        self.assertEqual(lst, [QQ])  # 用户手配的 QQ 保留
        self.assertEqual(owner.config['proactive_registered'], [])

    def test_idempotent_when_already_registered(self):
        star = FakeStar(session_list=[QQ, UMO])
        owner = Owner(star, autonomy=True, umo=UMO, registered=[UMO])
        self.assertIsNone(sync_proactive_sessions(owner))
        star.star_cls.config.save_config.assert_not_called()

    def test_group_binding_never_registered(self):
        star = FakeStar()
        owner = Owner(star, autonomy=True, umo='mimi-douyin:GroupMessage:g1')
        self.assertIsNone(sync_proactive_sessions(owner))
        self.assertEqual(star.star_cls.config['friend_settings']['session_list'], [])

    def test_switch_on_but_proactive_missing_is_silent(self):
        owner = Owner(None, autonomy=True, umo=UMO)
        self.assertIsNone(sync_proactive_sessions(owner))

    def test_save_failure_rolls_back_and_reports(self):
        star = FakeStar(session_list=[QQ])
        star.star_cls.config.save_config = MagicMock(side_effect=OSError('disk'))
        owner = Owner(star, autonomy=True, umo=UMO)
        self.assertEqual(sync_proactive_sessions(owner), 'failed')
        self.assertEqual(star.star_cls.config['friend_settings']['session_list'], [QQ])

    def test_switch_off_without_our_sessions_is_noop(self):
        star = FakeStar(session_list=[QQ])
        owner = Owner(star, autonomy=False, umo=UMO, registered=[])
        self.assertIsNone(sync_proactive_sessions(owner))
        self.assertEqual(star.star_cls.config['friend_settings']['session_list'], [QQ])


if __name__ == '__main__':
    unittest.main()
