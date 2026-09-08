# QPlayer QQ 音乐插件

QPlayer 音源插件（ABI 1.0），提供 QQ 音乐搜索、详情、推荐与个人歌单、
收藏、播放地址（Vkey）和歌词。

## 功能

- `searchSongs` — 搜索歌曲（移动端接口，匿名可用）
- `songDetails` — 按 songmid 取详情
- `playlistDetails` — 歌单详情与曲目（分页拉取，私密歌单需登录）
- `artistDetails` / `albumDetails` — 歌手与专辑详情
- `home` — 推荐歌单
- `userPlaylists` — 自建歌单（含「我喜欢」）与收藏的歌单
- `like` — 「我喜欢」的读取与增删（红心）
- `playlistMutation` — 新建/删除歌单、增删歌曲、收藏/取消收藏歌单
- `resolveStream` — M800/M500 MP3 播放地址（**需要登录**，2026 起匿名 Vkey 已收紧）
- `lyrics` — 明文 LRC（匿名可用）
- `login` / `account` — 网页登录（QQ/微信）、微信扫码、粘贴 Cookie 三种方式

写接口（收藏、歌单增删）的 `comm` 必须使用 `ct=26`；`ct=24` 会被服务端以
`80105`/`1101` 拒绝。参数名是驼峰的 `dirId`，「我喜欢」固定是 201 号目录。

## 构建与安装

```bash
./scripts/package.sh
python3 scripts/verify-package.py dist/*.qplug
```

默认生成的包未签名，只用于本地开发和手动导入测试。QPlayer 会对未受信任的
代码包显示安全警告。需要签名时，通过仓库外的 P-256 私钥构建：

```bash
QPLAYER_PLUGIN_SIGNING_KEY=/secure/path/publisher-private.pem ./scripts/package.sh
```

随后在 QPlayer 的“设置 → 音源插件”中导入生成的 `.qplug`。

正式版本由 GitHub Actions 在推送与 `plugin.json` 版本一致的 `v<version>` tag
时自动签名、校验并发布。`publisher-key.pub` 是 QPlayer 官方音源列表固定的
发布者公钥，不得随意更换；发布私钥只保存在维护者的离线备份和仓库 Secret 中。

## 登录(播放必需)

三种方式，任选其一：

- **QQ / 微信登录**：在应用内打开 QQ 音乐官方登录页，登录后自动取回 `qm_keyst`。
- **微信扫码**：用微信扫码确认，登录绑定该微信的 QQ 音乐账号。
- **粘贴 Cookie**：QQ 音乐客户端或网页登录后，抓取请求头中含 `musickey`/`qm_keyst`
  的 Cookie 粘贴进来。

插件仅提取播放与账号所需字段，通过 QPlayer 按插件隔离的加密凭据库保存；Vkey
请求使用真实 uin 和 musickey。请勿把 Cookie 提交到源码、Issue、日志或构建产物中。

## 参考

- API 行为移植自 Melodify 的 `QQMusicProvider` / `QQMusicApiClient`。
- `src/qrc.js` 是 Melodify `QrcDecryptor` 的纯 JS 移植（自定义 S-box 3DES 和
  zlib inflate）。QQ 歌词接口当前返回明文 LRC，故歌词直接走明文接口；
  `qrc.js` 保留备用。

本项目与腾讯或 QQ 音乐无隶属、合作或背书关系，不分发音频、账号凭据或受版权
保护的媒体内容。用户应自行遵守服务条款和当地法律。
