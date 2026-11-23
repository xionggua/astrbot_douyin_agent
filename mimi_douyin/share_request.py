"""Keep the original shared-post identity across DOM snapshot changes."""


def shared_post_request(peer_key, item):
    return {
        'peer_key': peer_key,
        'allow_truncate': True,  # DURSHARE_V1 用户主动分享=点名观看，超长走截断链（与POINTWATCH_V1同语义）
        'message_key': item['key'],
        'message_hint': {
            key: item.get(key)
            for key in ('native_id', 'sender', 'kind', 'links', 'text')
        },
    }
