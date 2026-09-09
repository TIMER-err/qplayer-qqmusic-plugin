# QPlayer QQ 音乐音源插件

<p><b>简体中文</b> · <a href="README.en.md">English</a></p>

QPlayer 的独立音源插件，由用户自行安装。它实现公开的 QPlayer JavaScript 插件 ABI
（apiVersion 1.0），把 QQ 音乐相关的接口地址、请求变换、登录处理与凭据全部留在
QPlayer 核心之外。

本项目与腾讯或 QQ 音乐没有隶属、合作或背书关系，不分发音频、账号凭据或受版权保护的
媒体内容。使用者需自行遵守服务条款与当地法律。

## 功能

| 能力 | 说明 |
|---|---|
| `searchSongs` | 搜索歌曲（移动端接口，匿名可用） |
| `songDetails` | 按 songmid 获取详情 |
| `playlistDetails` | 歌单详情与曲目，分页拉取，私密歌单需登录 |
| `artistDetails` / `albumDetails` | 歌手与专辑详情 |
| `home` | 推荐歌单，登录后使用 `PlaylistSquare/GetRecommendFeed` |
| `userPlaylists` | 自建歌单（含「我喜欢」）与收藏的歌单 |
| `like` | 「我喜欢」的读取与增删 |
| `playlistMutation` | 新建/删除歌单、增删歌曲、收藏/取消收藏歌单 |
| `resolveStream` | M800/M500 MP3 播放地址，**需要登录**（2026 起匿名 Vkey 已收紧） |
| `lyrics` | 明文 LRC，匿名可用 |
| `login` / `account` | 网页登录（QQ/微信）、微信扫码、粘贴 Cookie |

设置页还提供插件自有的**音源解锁**开关：歌曲在 QQ 音乐不可播放时，尝试从其他来源
匹配播放地址。该入口由插件声明、QPlayer 渲染。

接口实现上的两点约定：写接口（收藏、歌单增删）的 `comm` 必须使用 `ct=26`，`ct=24`
会被服务端以 `80105`/`1101` 拒绝；参数名是驼峰的 `dirId`，「我喜欢」固定为 201 号
目录。

完整的 ABI 与包格式见
[QPlayer 插件模板](https://github.com/TIMER-err/qplayer-plugin-template/blob/main/docs/ABI.md)。

## 登录

播放地址解析需要登录，三种方式任选其一：

- **QQ / 微信登录**：在应用内打开 QQ 音乐官方登录页，登录后自动取回 `qm_keyst`。
- **微信扫码**：用微信扫码确认，登录绑定该微信的 QQ 音乐账号。
- **粘贴 Cookie**：从 QQ 音乐客户端或网页登录后的请求头中取出含 `musickey`/
  `qm_keyst` 的 Cookie 粘贴进来。

插件仅提取播放与账号所需字段，通过 QPlayer 按插件隔离的加密凭据库保存；Vkey 请求使用
真实 uin 与 musickey。Cookie 不应提交到源码、Issue、日志或构建产物中。

## 构建

生成未签名的开发包：

```bash
./scripts/package.sh
python3 scripts/verify-package.py dist/*.qplug
```

默认产物未签名，仅用于本地开发与手动导入测试，QPlayer 会对未受信任的代码包显示安全
警告。随后在 QPlayer 的「设置 → 音源插件」中导入生成的 `.qplug`。

正式版本使用仓库外保存的 P-256 私钥签名：

```bash
QPLAYER_PLUGIN_SIGNING_KEY=/secure/path/publisher-private.pem ./scripts/package.sh
```

`publisher-key.pub` 是 QPlayer 官方音源列表固定的发布者公钥，不能更换；发布私钥只保存
在维护者的离线备份和仓库 Secret 中。

## 发布

推送与 `plugin.json` 版本一致的 `v<version>` tag 即触发发布工作流，自动签名、校验并
创建 GitHub Release。QPlayer 从本仓库的 latest release 读取可安装版本，因此 Release
中必须恰好挂载一个 `.qplug`，且不能是草稿或预发布。

## 歌词

QQ 歌词接口当前返回明文 LRC，插件直接使用明文接口。`src/qrc.js` 是 QRC 加密歌词的
纯 JS 解密实现（自定义 S-box 3DES 与 zlib inflate），当前未启用，保留备用。

本插件独立分发，不由 QPlayer 捆绑或托管。QQ 音乐为其权利人的商标。
