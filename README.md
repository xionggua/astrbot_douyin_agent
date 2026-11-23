# 抖音Agent · AstrBot 插件

<a href="https://t.me/xuqingci_douyin_agent"><img src="https://raw.githubusercontent.com/xionggua/astrbot_douyin_agent/main/assets/badge_telegram.svg" alt="Telegram 交流群"></a>
<a href="https://qm.qq.com/q/rQK9dPdVoA"><img src="https://raw.githubusercontent.com/xionggua/astrbot_douyin_agent/main/assets/badge_qq.svg" alt="QQ 交流群"></a>

让你在 AstrBot 配置的 Agent 可以直接接入抖音平台。

## 功能简介

- **私聊接入**：绑定一个抖音私信会话，让 Agent 像真人一样与你收发消息
- **分享视频**：Agent 可以浏览你分享的视频，也可以给你分享视频
- **自主浏览**：主动刷推荐视频，按预设人格独立判断点赞/评论/分享，配合[主动消息插件](https://github.com/Pancakes-Labs/astrbot_plugin_proactive_chat)还能主动找你聊
- **指令搜索**：一句"帮我搜xxx"就开搜，看完逐条发卡片+观后感，支持连看 n 条和"再看一条"接续
- **多端互通**：你可以在 QQ 或其它任何你接入的平台直接对你的 Agent 用自然语言下达指令，例如：让它去刷抖音、给你的抖音发消息、搜索指定内容并分享到你的抖音私信等等
- **长期记忆与多端记忆互通**：依赖 [LivingMemory](https://github.com/lxfight-s-Astrbot-Plugins/astrbot_plugin_livingmemory) 插件
- **主动评论**：开启评论开关后，主动在作品下评论。（该功能有封号风险，请慎重使用。）
- **群聊支持（测试中）**：@机器人、智能接话、跨成员分享关联

## 环境要求

### 硬件要求

**本地直接运行浏览器**

| | 最低配置 | 推荐配置 |
|---|:---:|:---:|
| **CPU** | 4 核 | 8 核 |
| **内存** | 4 GB | 8 GB |
| **硬盘（剩余空间）** | 10 GB | 20 GB |

**远程运行浏览器**

| | 最低配置 | 推荐配置 |
|---|:---:|:---:|
| **CPU** | 2 核 | 2 核 |
| **内存** | 2 GB | 4 GB |
| **硬盘（剩余空间）** | 1 GB | 10 GB |

> 以上要求已包含 AstrBot 本身的资源消耗，无需另行加码。

### 软件要求

- AstrBot >= 4.29.0
- Node.js >= 20
- Playwright：在插件设置页一键安装到插件自己的数据目录，不污染系统环境
- Edge 或 Chrome：可直接复用系统内已安装的 Edge 或 Chrome，也可在设置页下载独立的 Chromium。采用远程浏览器部署时，只需在远程主机上安装，本机无需重复安装
- FFmpeg 与 FFprobe：用于视频/音频的处理与压缩。采用远程浏览器部署时，远程主机与**本机都需安装**（本机用于远程压缩失败时的兜底）

用于解析视频、音频的多模态大模型接口，以及用于收发消息的抖音账号，需要你自行准备。

## 安装

- **方法一**：在 AstrBot 的插件市场直接搜索"抖音Agent"，一键安装
- **方法二**：将本仓库 Releases 最新版的 zip 文件解压到 AstrBot 的 `data/plugins/` 目录
- **方法三**：在 AstrBot 的插件管理里选择"从链接安装"，粘贴本仓库地址：`https://github.com/xionggua/astrbot_douyin_agent`

## 产品文档

见 [产品文档.md](docs/产品文档.md)。

## 远程浏览器部署（可选，推荐）

默认浏览器跑在 AstrBot 所在机器上。如果你的 AstrBot 在云服务器，可以把浏览器部署在家里的宽带机器上（对抖音风控更友好，下载也更快），详见 [douyin_agent_remote_browser](https://github.com/xionggua/douyin_agent_remote_browser) 项目。

## 已知限制

- 单条文字回复上限 2000 字符
- 受限于抖音网页端，不支持收发语音消息等功能，表情包识别能力测试中
- 对于用户"回复"动作识别能力有限，优化中
- 群聊仍在测试中，大群稳定性未知
- 浏览器页面结构依赖抖音网页版 DOM，前端大改版后个别功能可能需要适配

## 开源协议

本项目自 1.0.0 起以 [AGPL-3.0](LICENSE) 发布：代码可自由使用、修改与分发，但衍生作品必须同样开源；闭源商用不可行。所含上游代码（v0.5.4 基线）以 MIT 授权，原文见 [LICENSE-MIT](LICENSE-MIT)。

> 致谢上游：本项目基于 [astrbot_plugin_douyin_dm](https://github.com/lxy005tt-collab/astrbot_plugin_douyin_dm)（作者 [lxy005tt-collab](https://github.com/lxy005tt-collab)）v0.5.4 fork 演进而来，完整演进记录见 [BASE.md](docs/BASE.md)。

## 鸣谢

- 原作者 [lxy005tt-collab](https://github.com/lxy005tt-collab)：本项目基于其 [astrbot_plugin_douyin_dm](https://github.com/lxy005tt-collab/astrbot_plugin_douyin_dm) 演进而来
- 内测用户 @罐头、@长卿：感谢你们在测试阶段的耐心配合与反馈

## 赞助

如果这个项目对你有帮助，欢迎赞助支持，作者会非常感激：

| 支付宝 | 微信 |
|:---:|:---:|
| <img src="https://raw.githubusercontent.com/xionggua/astrbot_douyin_agent/main/assets/alipay_qr.jpg" width="260" alt="支付宝收款码"/> | <img src="https://raw.githubusercontent.com/xionggua/astrbot_douyin_agent/main/assets/wechat_qr.png" width="260" alt="微信收款码"/> |

几点说明：

- **完全自愿**：赞助秉承自愿原则，无任何强制付费，不赞助也请放心使用
- **功能全免费**：赞助不附带任何额外功能，本项目的全部功能对所有人免费开放
- **款项用途**：赞助款将全部用于本项目的各项支出，包括 AI 接口（token）费用、测试服务器与带宽费用、浏览器及测试设备维护、域名与证书续费等
- **赞助者优先响应**：赞助用户反馈的 bug 会优先修复、提出的功能建议会优先评估开发，并可直接与作者私聊沟通
- **反馈渠道对所有人开放**：非赞助用户同样可以通过 Telegram 群组、QQ 群、GitHub Issues 等方式反馈问题，按紧急程度排期处理
