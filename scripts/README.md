打包脚本来自 qplayer-plugin-template（https://github.com/TIMER-err/qplayer-plugin-template）：

- `package.sh` 生成 `.qplug` 和 `META-INF/qplayer-files.json` 哈希清单；仅在设置
  `QPLAYER_PLUGIN_SIGNING_KEY` 时生成签名。
- `verify-package.py` 校验包结构和文件摘要。
