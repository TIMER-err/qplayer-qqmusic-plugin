# QPlayer QQ 音乐插件

QPlayer 音源插件（ABI 1.0），提供 QQ 音乐搜索、详情、推荐歌单、
播放地址（Vkey）和歌词。

## 功能

- `searchSongs` — 搜索歌曲（移动端接口，匿名可用）
- `songDetails` — 按 songmid 取详情
- `home` — 推荐歌单
- `resolveStream` — M800/M500 MP3 播放地址（**需要登录**，2026 起匿名 Vkey 已收紧）
- `lyrics` — 明文 LRC（匿名可用）
- `login` / `account` — Cookie 登录（提取 musickey/uin，加密保存）

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

QQ 音乐客户端或网页登录后，抓取 `qqmusic.music.qq.com` 请求头中的 Cookie，
粘贴到“插件设置 → 登录”。插件仅提取播放所需字段，通过 QPlayer 按插件隔离的
加密凭据库保存；Vkey 请求使用真实 uin 和 musickey。请勿把 Cookie 提交到源码、
Issue、日志或构建产物中。

## 参考

- API 行为移植自 Melodify 的 `QQMusicProvider` / `QQMusicApiClient`。
- `src/qrc.js` 是 Melodify `QrcDecryptor` 的纯 JS 移植（自定义 S-box 3DES 和
  zlib inflate）。QQ 歌词接口当前返回明文 LRC，故歌词直接走明文接口；
  `qrc.js` 保留备用。

本项目与腾讯或 QQ 音乐无隶属、合作或背书关系，不分发音频、账号凭据或受版权
保护的媒体内容。用户应自行遵守服务条款和当地法律。
