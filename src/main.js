"use strict";

// QQ 音乐源插件：搜索 / 歌曲详情 / 推荐歌单 / 播放地址(Vkey) / 歌词。
// 播放(Vkey)需要登录:QQ 音乐客户端 Cookie 中的 musickey(2026 起匿名 vkey 已收紧)。
// API 参考 Melodify QQMusicProvider / QQMusicApiClient 移植。

var UA_PC = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
var UA_MOBILE = "Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1";
var MUSICU = "https://u.y.qq.com/cgi-bin/musicu.fcg";
var SEARCH_HOST = "https://c.y.qq.com";
var STREAM_HOST = "https://ws.stream.qqmusic.qq.com/";
var REF_SEARCH = "https://y.qq.com/portal/search.html";
var REF_BASE = "https://y.qq.com/";
var REF_LYRIC = "https://y.qq.com/portal/player.html";
// 微信扫码登录。QQ 号那条路(ptqrshow)用不了:它返回的是 PNG,二维码里编的
// http://txz.qq.com/p?k=<服务端令牌> 只存在于图像内,响应头和 cookie 都拿不到,
// 而宿主是拿 qrContent 字符串自己 QrMatrix.encode 出二维码的。
var WX_APPID = "wx48db31d50e334801";
var WX_QRCONNECT = "https://open.weixin.qq.com/connect/qrconnect";
var WX_POLL = "https://lp.open.weixin.qq.com/connect/l/qrconnect";
var WX_CONFIRM = "https://open.weixin.qq.com/connect/confirm?uuid=";
var REF_WX = "https://open.weixin.qq.com/";
var qrcDecrypt = require("./qrc").qrcDecrypt;
// 账号自带的「我喜欢」歌单固定是 201 号目录,红心就是往它里面增删。
var FAV_DIR_ID = 201;
// 一次歌单详情最多取多少首:aiDissInfo 单页上限 1000,再多就分页续拉。
var DISS_PAGE = 500;
var MAX_PLAYLIST_SONGS = 3000;

function call(method, args) { return qplayer.call(method, args || {}); }

function secureUrl(value) {
  value = String(value || "");
  return value.indexOf("http://") === 0 ? "https://" + value.slice(7) : value;
}

// ---- 登录态(credentials:QQ 音乐 Cookie) ------------------------------------

function loadCookies() {
  return call("credentials.get", { key: "cookies" }).then(function (stored) {
    if (!stored) return {};
    try { return JSON.parse(stored); } catch (_) { return {}; }
  });
}

/**
 * 扫码登录拿到的是一份凭据对象而不是 cookie。它必须跟 "cookies" 分开存:
 * musicu() 会把 "cookies" 里的每个键都拼进 Cookie 请求头,
 * refresh_token/loginType 这类字段混进去会污染请求。
 */
function loadSession() {
  return call("credentials.get", { key: "session" }).then(function (stored) {
    if (!stored) return {};
    try { return JSON.parse(stored); } catch (_) { return {}; }
  }, function () { return {}; });
}

function saveSession(value) {
  return call("credentials.put", { key: "session", value: JSON.stringify(value) });
}

function httpGetText(url, referer, ua, timeoutMs) {
  return call("http.request", {
    url: url, method: "GET",
    headers: { "User-Agent": ua || UA_PC, "Referer": referer || REF_BASE },
    timeoutMs: timeoutMs || 15000
  }).then(function (response) {
    if (response.status < 200 || response.status >= 300) throw new Error("HTTP " + response.status);
    return String(response.body || "");
  });
}

function cookieValue(cookies, keys) {
  for (var i = 0; i < keys.length; i++) {
    var v = cookies[keys[i]];
    if (v) return String(v);
  }
  return "";
}

function musicKey(cookies) {
  return cookieValue(cookies, ["musickey", "qm_keyst", "qqmusic_key"]);
}

function musicUin(cookies) {
  var uin = cookieValue(cookies, ["musicid", "uin", "wxuin"]);
  if (!uin) return "0";
  var digits = String(uin).replace(/^[oO]0*/, "");
  return digits ? digits : String(uin);
}

function gtk(key) {
  var h = 5381;
  for (var i = 0; i < key.length; i++) h = (h + ((h << 5) + key.charCodeAt(i))) | 0;
  return h & 0x7fffffff;
}

// ---- HTTP helpers ----------------------------------------------------------

function httpGetJson(url, referer, ua) {
  return call("http.request", {
    url: url, method: "GET",
    headers: { "User-Agent": ua || UA_MOBILE, "Referer": referer || REF_BASE },
    timeoutMs: 15000
  }).then(function (response) {
    if (response.status < 200 || response.status >= 300) throw new Error("HTTP " + response.status);
    return JSON.parse(response.body || "{}");
  });
}

function httpPostJson(url, body, referer, headers) {
  var all = { "User-Agent": UA_PC, "Content-Type": "application/json", "Referer": referer || REF_BASE };
  if (headers) {
    Object.keys(headers).forEach(function (key) { all[key] = headers[key]; });
  }
  return call("http.request", {
    url: url, method: "POST", headers: all,
    body: typeof body === "string" ? body : JSON.stringify(body),
    timeoutMs: 15000
  }).then(function (response) {
    if (response.status < 200 || response.status >= 300) throw new Error("HTTP " + response.status);
    return JSON.parse(response.body || "{}");
  });
}

/** 写接口(收藏/歌单增删)只在 ct=26 下被受理:ct=24 会返回 80105/1101。 */
var WRITE_COMM = { ct: 26, cv: 0, needNewCode: 0 };

/** musicu.fcg 批量请求;带登录 cookie 时使用真实 uin 与 musickey。 */
function musicu(entries, override) {
  return Promise.all([loadCookies(), loadSession()]).then(function (both) {
    var cookies = both[0];
    var session = both[1] || {};
    var key = musicKey(cookies);
    var uin = key ? musicUin(cookies) : "0";
    var gtkValue = gtk(key);
    var comm = {
      cv: 4747474, ct: 24, format: "json", inCharset: "utf-8", outCharset: "utf-8",
      notice: 0, platform: "yqq.json", needNewCode: 1, uin: uin,
      g_tk: gtkValue, g_tk_new_20200303: gtkValue
    };
    if (override) Object.keys(override).forEach(function (k) { comm[k] = override[k]; });
    // 扫码登录的 musickey 要靠 authst + tmeLoginType 才被认;loginType 用服务端
    // 在 Login 响应里回的值,不写死(各家参考实现对这个编号的说法互相矛盾)。
    // 粘贴/网页登录拿到的 Cookie 自带 tmeLoginType,同样要带上,否则登录态只对
    // 读接口生效,写接口一律被拒。
    var loginType = Number(session.loginType || cookies.tmeLoginType || 0);
    if (key && loginType) {
      comm.authst = key;
      comm.tmeLoginType = loginType;
    }
    var body = { comm: comm };
    Object.keys(entries).forEach(function (k) { body[k] = entries[k]; });
    var headers = null;
    if (key) {
      var parts = [];
      Object.keys(cookies).forEach(function (name) {
        if (cookies[name]) parts.push(encodeURIComponent(name) + "=" + encodeURIComponent(String(cookies[name])));
      });
      if (parts.length) headers = { "Cookie": parts.join("; ") };
    }
    return httpPostJson(MUSICU, body, REF_BASE, headers);
  });
}

// ---- DTO (宿主兼容字段,同 netease 插件) -----------------------------------

function artistsOf(list) {
  var out = [];
  (list || []).forEach(function (item) {
    var id = String((item && (item.mid || item.id)) || "");
    // 宿主的 MediaId 拒绝空 nativeId 并抛异常,会连带打挂整条结果,所以这里先滤掉。
    if (id) out.push({ id: id, name: (item && item.name) || "" });
  });
  return out;
}

/**
 * 宿主的歌曲标识是 mid,而收藏/歌单写接口只认数字 songId。凡是解析过的歌曲都
 * 顺手记下这层映射,红心一首刚播过的歌就不必再多一次 songDetails 往返。
 */
var numericIds = {};

function rememberNumericId(mid, id) {
  if (mid && id) numericIds[String(mid)] = Number(id);
}

function songDto(raw) {
  raw = raw || {};
  var album = raw.album || {};
  var mid = raw.songmid || raw.mid || "";
  rememberNumericId(mid, raw.songid || raw.id);
  return {
    id: mid,
    title: raw.songname || raw.name || raw.title || "",
    artists: artistsOf(raw.singer || raw.singers),
    album: album.mid ? { id: String(album.mid), name: album.name || "" } : null,
    durationMs: Number(raw.interval || 0) * 1000,
    artworkUrl: secureUrl(raw.albummid
      ? "https://y.gtimg.cn/music/photo_new/T002R300x300M000" + raw.albummid + ".jpg"
      : (album.pmid ? "https://y.gtimg.cn/music/photo_new/T002R300x300M000" + album.pmid + ".jpg" : "")),
    playable: true, trial: false
  };
}

/** QQ 的图片 mid 有两种形态:裸 mid 和带版本后缀的 pmid,两者都能取到图。 */
function photoUrl(prefix, id) {
  return id ? "https://y.gtimg.cn/music/photo_new/" + prefix + "R300x300M000" + id + ".jpg" : "";
}

/** "2003-07-31" → epoch ms;解析不出来就返回 0,由宿主当作未知发行日期。 */
function publishMs(text) {
  var parts = String(text || "").split("-");
  if (parts.length < 3) return 0;
  var year = Number(parts[0]), month = Number(parts[1]), day = Number(parts[2]);
  if (!year || !month || !day) return 0;
  return Date.UTC(year, month - 1, day);
}

/** 兼容 GetAlbumList 的扁平条目与 GetAlbumDetail 的 basicInfo。 */
function albumDto(raw, songs) {
  raw = raw || {};
  var mid = raw.albumMid || raw.mid || "";
  // GetAlbumList 只给 singerName、不给 mid,而宿主要求 artist id 非空,
  // 所以退回用首曲的歌手(带 mid)来标注专辑归属。
  var artists = raw.singerMid && raw.singerName
    ? [{ id: String(raw.singerMid), name: raw.singerName }]
    : ((songs && songs[0] && songs[0].artists) || []);
  return {
    id: String(mid),
    name: raw.albumName || raw.name || "",
    artworkUrl: secureUrl(photoUrl("T002", raw.pmid || mid)),
    publishTimeMs: publishMs(raw.publishDate),
    description: raw.desc || "",
    trackCount: Number(raw.totalNum || (songs || []).length || 0),
    artists: artists,
    songs: songs || []
  };
}

/** 推荐位/搜索等只给概要的歌单条目。 */
function playlistDto(raw) {
  raw = raw || {};
  return {
    id: String(raw.content_id || raw.tid || raw.id || ""),
    name: raw.title || raw.name || "",
    description: raw.desc || "",
    artworkUrl: secureUrl(raw.cover || raw.picUrl || raw.logo || ""),
    owner: ownerRef(raw.creator || raw.uin, raw.username || raw.nickname || raw.nick),
    trackCount: Number(raw.song_cnt || raw.total_song_num || raw.songnum || raw.songNum || 0),
    playCount: Number(raw.access_num || raw.play_count || raw.listen_num || 0),
    subscribed: false, owned: false
  };
}

/**
 * QQ 的 uin 有三种形态:数字、"o" 前缀的加密串和带 ** 的脱敏串。宿主要用它组
 * 成 MediaId,只有纯数字是可用的,其余一律当作没有作者信息。
 */
function ownerRef(uin, name) {
  var id = String(uin || "");
  if (!/^[0-9]+$/.test(id) || id === "0") id = "";
  var label = String(name || "");
  return id || label ? { id: id, name: label } : null;
}

/** aiDissInfo 的 dirinfo(歌单详情页)。 */
function dirinfoDto(dir, tid, songs) {
  dir = dir || {};
  var dirid = Number(dir.dirid || 0);
  var owned = Number(dir.owndir || 0) === 1;
  return {
    id: String(tid),
    name: dir.title || "",
    description: dir.desc || "",
    artworkUrl: secureUrl(dir.picurl || dir.picurl2 || ""),
    owner: ownerRef(dir.host_uin, dir.host_nick),
    trackCount: Number(dir.songnum || (songs || []).length || 0),
    playCount: Number(dir.listennum || 0),
    subscribed: !owned && dirid > 0,
    owned: owned,
    mutable: owned,
    // 「我喜欢」是账号自带的固定歌单,删不掉。
    deletable: owned && dirid !== FAV_DIR_ID,
    songs: songs || []
  };
}

/** GetPlaylistByUin 的自建歌单条目。 */
function ownPlaylistDto(raw) {
  raw = raw || {};
  var dirid = Number(raw.dirId || 0);
  return {
    id: String(raw.tid || ""),
    name: raw.dirName || "",
    description: raw.desc || "",
    artworkUrl: secureUrl(raw.picUrl || raw.bigpicUrl || raw.albumPicUrl || ""),
    owner: ownerRef(raw.uin, raw.nick),
    trackCount: Number(raw.songNum || 0),
    playCount: Number(raw.play_cnt || 0),
    subscribed: false, owned: true,
    mutable: true, deletable: dirid !== FAV_DIR_ID
  };
}

/** GetPlaylistFavInfo 的收藏歌单条目(作者是别人,只能取消收藏)。 */
function favPlaylistDto(raw) {
  raw = raw || {};
  return {
    id: String(raw.tid || ""),
    name: raw.name || raw.dirName || "",
    description: raw.desc || "",
    artworkUrl: secureUrl(raw.logo || raw.picUrl || raw.albumPicUrl || ""),
    owner: ownerRef(raw.uin, raw.nickname || raw.nick),
    trackCount: Number(raw.songnum || raw.songNum || 0),
    playCount: 0,
    subscribed: true, owned: false,
    mutable: false, deletable: false
  };
}

// ---- Handlers --------------------------------------------------------------

function searchSongs(args) {
  var page = Math.max(1, Math.floor(Number(args.cursor || 0) / Math.max(1, Number(args.limit || 50))) + 1);
  var url = SEARCH_HOST + "/soso/fcgi-bin/search_for_qq_cp?w="
    + encodeURIComponent(args.query || "")
    + "&format=json&p=" + page + "&n=" + Number(args.limit || 50);
  return httpGetJson(url, REF_SEARCH, UA_MOBILE).then(function (body) {
    var data = (body.data || {}).song || {};
    var items = (data.list || []).map(songDto);
    var hasMore = page * Number(args.limit || 50) < Number(data.totalnum || items.length);
    return { items: items, nextCursor: hasMore ? String(page * Number(args.limit || 50)) : "" };
  });
}

function songDetails(args) {
  var mids = (args.ids || []).filter(Boolean);
  if (!mids.length) return Promise.resolve([]);
  var entries = {};
  mids.forEach(function (mid, index) {
    entries["req_" + index] = {
      module: "music.pf_song_detail_svr",
      method: "get_song_detail_yqq",
      param: { song_mid: mid }
    };
  });
  return musicu(entries).then(function (body) {
    var out = [];
    mids.forEach(function (mid, index) {
      var data = body["req_" + index] && body["req_" + index].data;
      if (data && data.track_info) out.push(songDto(data.track_info));
    });
    return out;
  });
}

function home(args) {
  return musicu({
    recomPlaylist: {
      module: "playlist.HotRecommendServer",
      method: "get_hot_recommend",
      param: { async: 1, cmd: 2 }
    }
  }).then(function (body) {
    var data = body.recomPlaylist && body.recomPlaylist.data || {};
    var list = (data.v_hot || []).map(playlistDto);
    return { songs: [], playlists: list.slice(0, Number(args.limit || 12)) };
  });
}

/** 一页歌单详情。第二页起只要歌曲,省掉重复的 dirinfo/标签。 */
function dissPage(tid, begin, num) {
  return loadCookies().then(function (cookies) {
    return musicu({
      req: {
        module: "music.srfDissInfo.aiDissInfo",
        method: "uniform_get_Dissinfo",
        param: {
          disstid: Number(tid), userinfo: 1, tag: 1, orderlist: 1,
          song_begin: begin, song_num: num, onlysonglist: begin > 0 ? 1 : 0,
          // 自己的私密歌单要靠这个加密 uin 才认领得到。
          enc_host_uin: String(cookies.euin || "")
        }
      }
    });
  }).then(function (body) {
    var node = body.req || {};
    if (Number(node.code || 0) !== 0) {
      throw new Error("歌单加载失败(" + node.code + ")");
    }
    return node.data || {};
  });
}

function playlistDetails(args) {
  var tid = String(args.id || "");
  if (!tid) throw new Error("缺少歌单 ID");
  return dissPage(tid, 0, DISS_PAGE).then(function (first) {
    var dir = first.dirinfo || {};
    var songs = (first.songlist || []).slice();
    var total = Math.min(MAX_PLAYLIST_SONGS,
      Number(dir.songnum || first.total_song_num || songs.length || 0));
    var offsets = [];
    for (var begin = songs.length; begin > 0 && begin < total; begin += DISS_PAGE) {
      offsets.push(begin);
    }
    // 顺序续拉:并发对同一个歌单会被限流,而歌单顺序本身也要保持。
    return offsets.reduce(function (chain, begin) {
      return chain.then(function () {
        return dissPage(tid, begin, DISS_PAGE).then(function (page) {
          songs = songs.concat(page.songlist || []);
        });
      });
    }, Promise.resolve()).then(function () {
      return dirinfoDto(dir, tid, songs.map(songDto));
    });
  });
}

/** 登录态下的真实 uin;未登录返回 ""。 */
function requireUin() {
  return loadCookies().then(function (cookies) {
    var uin = musicUin(cookies);
    return musicKey(cookies) && uin !== "0" ? uin : "";
  });
}

function userPlaylists(args) {
  var limit = Math.min(500, Math.max(1, Number(args.limit || 100)));
  return requireUin().then(function (uin) {
    if (!uin) return [];
    return musicu({
      mine: {
        module: "music.musicasset.PlaylistBaseRead",
        method: "GetPlaylistByUin",
        param: { uin: uin }
      },
      fav: {
        module: "music.musicasset.PlaylistFavRead",
        method: "GetPlaylistFavInfo",
        param: { uin: uin, offset: 0, size: Math.min(100, limit) }
      }
    }).then(function (body) {
      var out = [];
      var mine = (body.mine && body.mine.data || {}).v_playlist || [];
      mine.forEach(function (item) {
        var dto = ownPlaylistDto(item);
        // 「我喜欢」排在最前,和 QQ 音乐自己的顺序一致。
        if (dto.id && dto.name) {
          if (Number((item || {}).dirId || 0) === FAV_DIR_ID) out.unshift(dto);
          else out.push(dto);
        }
      });
      var fav = (body.fav && body.fav.data || {}).v_list || [];
      fav.forEach(function (item) {
        var dto = favPlaylistDto(item);
        if (dto.id && dto.name) out.push(dto);
      });
      return out.slice(0, limit);
    });
  });
}

/** tid → 本地目录号(写接口只认 dirId)。 */
function dirIdForTid(tid) {
  var wanted = String(tid || "");
  return requireUin().then(function (uin) {
    if (!uin) throw new Error("请先登录 QQ 音乐");
    return musicu({
      mine: {
        module: "music.musicasset.PlaylistBaseRead",
        method: "GetPlaylistByUin",
        param: { uin: uin }
      }
    }).then(function (body) {
      var list = (body.mine && body.mine.data || {}).v_playlist || [];
      for (var i = 0; i < list.length; i++) {
        if (String((list[i] || {}).tid || "") === wanted) return Number(list[i].dirId || 0);
      }
      throw new Error("这个歌单不是你创建的，无法修改");
    });
  });
}

/** 「我喜欢」的 tid;没登录或没有该目录时返回 0。 */
function favPlaylistTid() {
  return requireUin().then(function (uin) {
    if (!uin) return 0;
    return musicu({
      mine: {
        module: "music.musicasset.PlaylistBaseRead",
        method: "GetPlaylistByUin",
        param: { uin: uin }
      }
    }).then(function (body) {
      var list = (body.mine && body.mine.data || {}).v_playlist || [];
      for (var i = 0; i < list.length; i++) {
        if (Number((list[i] || {}).dirId || 0) === FAV_DIR_ID) return Number(list[i].tid || 0);
      }
      return 0;
    });
  });
}

function songNumericId(mid) {
  var key = String(mid || "");
  if (!key) return Promise.reject(new Error("缺少歌曲 ID"));
  if (numericIds[key]) return Promise.resolve(numericIds[key]);
  return songDetails({ ids: [key] }).then(function () {
    if (numericIds[key]) return numericIds[key];
    throw new Error("无法解析歌曲编号");
  });
}

/** 往目录里增删歌曲。写接口的 comm 必须是 WRITE_COMM,参数名也是驼峰的 dirId。 */
function writeSonglist(dirId, songIds, add) {
  var songs = songIds.map(function (id) { return { songId: Number(id), songType: 0 }; });
  return musicu({
    req: {
      module: "music.musicasset.PlaylistDetailWrite",
      method: add ? "AddSonglist" : "DelSonglist",
      param: { dirId: Number(dirId), v_songInfo: songs }
    }
  }, WRITE_COMM).then(function (body) {
    var node = body.req || {};
    if (Number(node.code || 0) !== 0) throw new Error("操作失败(" + node.code + ")");
    return true;
  });
}

function like(args) {
  switch (args.operation) {
    case "list":
      return favPlaylistTid().then(function (tid) {
        if (!tid) return [];
        return dissPage(tid, 0, DISS_PAGE).then(function (data) {
          var total = Math.min(MAX_PLAYLIST_SONGS,
            Number((data.dirinfo || {}).songnum || 0));
          var songs = (data.songlist || []).slice();
          var offsets = [];
          for (var begin = songs.length; begin > 0 && begin < total; begin += DISS_PAGE) {
            offsets.push(begin);
          }
          return offsets.reduce(function (chain, begin) {
            return chain.then(function () {
              return dissPage(tid, begin, DISS_PAGE).then(function (page) {
                songs = songs.concat(page.songlist || []);
              });
            });
          }, Promise.resolve()).then(function () {
            return songs.map(function (song) {
              rememberNumericId((song || {}).mid, (song || {}).id);
              return String((song || {}).mid || "");
            }).filter(Boolean);
          });
        });
      });
    case "set":
      return songNumericId(args.id).then(function (songId) {
        return writeSonglist(FAV_DIR_ID, [songId], args.liked !== false);
      });
    default:
      throw new Error("未知收藏操作");
  }
}

function playlistMutation(args) {
  switch (args.operation) {
    case "create": {
      var name = String(args.name || "").trim();
      if (!name) throw new Error("歌单名称为空");
      return musicu({
        req: {
          module: "music.musicasset.PlaylistBaseWrite",
          method: "AddPlaylist",
          param: { dirName: name }
        }
      }, WRITE_COMM).then(function (body) {
        var node = body.req || {};
        if (Number(node.code || 0) !== 0) throw new Error("创建歌单失败(" + node.code + ")");
        var result = (node.data || {}).result || {};
        return { id: String(result.tid || "") };
      });
    }
    case "delete":
      return dirIdForTid(args.playlistId).then(function (dirId) {
        if (dirId === FAV_DIR_ID) throw new Error("「我喜欢」不能删除");
        return musicu({
          req: {
            module: "music.musicasset.PlaylistBaseWrite",
            method: "DelPlaylist",
            param: { dirId: dirId }
          }
        }, WRITE_COMM).then(function (body) {
          var node = body.req || {};
          if (Number(node.code || 0) !== 0) throw new Error("删除歌单失败(" + node.code + ")");
          return true;
        });
      });
    case "add":
    case "remove": {
      var adding = args.operation === "add";
      var mids = (args.songIds || []).filter(Boolean);
      if (!mids.length) return true;
      return dirIdForTid(args.playlistId).then(function (dirId) {
        return Promise.all(mids.map(songNumericId)).then(function (ids) {
          return writeSonglist(dirId, ids, adding);
        });
      });
    }
    case "subscribe": {
      // 宿主用同一个操作表达收藏与取消,已收藏的歌单再点一次即取消。
      var tid = Number(args.playlistId || 0);
      if (!tid) throw new Error("缺少歌单 ID");
      return userPlaylists({ limit: 500 }).then(function (playlists) {
        var subscribed = playlists.some(function (item) {
          return item.id === String(tid) && item.subscribed;
        });
        return musicu({
          req: {
            module: "music.musicasset.PlaylistFavWrite",
            method: subscribed ? "CancelFavPlaylist" : "FavPlaylist",
            param: subscribed
              ? { v_playlistId: [tid] }
              : { v_playlistId: [tid], opType: 1 }
          }
        }, WRITE_COMM).then(function (body) {
          var node = body.req || {};
          if (Number(node.code || 0) !== 0) throw new Error("操作失败(" + node.code + ")");
          return true;
        });
      });
    }
    default:
      throw new Error("未知歌单操作");
  }
}

function artistDetails(args) {
  var mid = String(args.id || "");
  if (!mid) throw new Error("缺少歌手 ID");
  var limit = Math.min(100, Math.max(1, Number(args.limit || 50)));
  return musicu({
    info: {
      module: "music.musichallSinger.SingerInfoInter",
      method: "GetSingerDetail",
      param: { singer_mids: [mid], pic: 1, group_singer: 1, wiki_singer: 1, ex_singer: 1 }
    },
    songs: {
      module: "musichall.song_list_server",
      method: "GetSingerSongList",
      param: { singerMid: mid, begin: 0, num: limit, order: 1 }
    },
    albums: {
      module: "music.musichallAlbum.AlbumListServer",
      method: "GetAlbumList",
      param: { singerMid: mid, begin: 0, num: limit, order: 1 }
    }
  }).then(function (body) {
    var singer = ((body.info && body.info.data || {}).singer_list || [])[0] || {};
    var basic = singer.basic_info || {};
    var extra = singer.ex_info || {};
    var songData = body.songs && body.songs.data || {};
    var albumData = body.albums && body.albums.data || {};
    var songs = (songData.songList || []).map(function (row) {
      return songDto((row || {}).songInfo);
    });
    var albums = (albumData.albumList || []).map(function (row) { return albumDto(row, null); });
    return {
      id: mid,
      name: basic.name || "",
      artworkUrl: secureUrl(photoUrl("T001", basic.singer_pmid || mid)),
      description: extra.desc || "",
      albumCount: Number(albumData.total || albums.length || 0),
      songCount: Number(songData.totalNum || songs.length || 0),
      songs: songs,
      albums: albums
    };
  });
}

function albumDetails(args) {
  var mid = String(args.id || "");
  if (!mid) throw new Error("缺少专辑 ID");
  return musicu({
    info: {
      module: "music.musichallAlbum.AlbumInfoServer",
      method: "GetAlbumDetail",
      param: { albumMid: mid }
    },
    songs: {
      module: "music.musichallAlbum.AlbumSongList",
      method: "GetAlbumSongList",
      param: { albumMid: mid, begin: 0, num: 100, order: 1 }
    }
  }).then(function (body) {
    var basic = (body.info && body.info.data || {}).basicInfo || {};
    var songData = body.songs && body.songs.data || {};
    var songs = (songData.songList || []).map(function (row) {
      return songDto((row || {}).songInfo);
    });
    if (!basic.albumMid) basic.albumMid = mid;
    if (!basic.totalNum) basic.totalNum = songData.totalNum;
    return albumDto(basic, songs);
  });
}

function resolveStream(args) {
  var mid = String(args.id || "");
  if (!mid) throw new Error("缺少歌曲 ID");
  var guid = String(Math.floor(1000000000 + Math.random() * 9000000000));
  var filenames = ["M800" + mid + mid + ".mp3", "M500" + mid + mid + ".mp3"];
  return loadCookies().then(function (cookies) {
    // 登录态下 param.uin 必须是真实 uin;写死 "0" 会让 vkey 服务按匿名处理,
    // 于是连会员歌也拿不到 purl。
    var uin = musicKey(cookies) ? musicUin(cookies) : "0";
    return musicu({
      req_1: {
        module: "music.vkey.GetVkey",
        method: "UrlGetVkey",
        param: {
          guid: guid, songmid: [mid, mid], songtype: [0, 0],
          uin: uin, loginflag: 1, platform: "20", filename: filenames
        }
      }
    });
  }).then(function (body) {
    var data = body.req_1 && body.req_1.data || {};
    // 不要用 data.sip:它目前恒为 aqqmusic.tc.qq.com,不在 plugin.json 的
    // networkDomains 里,宿主会以 "stream URL outside its grant" 拒收整首歌。
    // 各 CDN 主机对同一个 purl 可互换,固定用已声明的 STREAM_HOST 即可。
    var host = STREAM_HOST;
    var infos = data.midurlinfo || [];
    for (var i = 0; i < filenames.length; i++) {
      for (var j = 0; j < infos.length; j++) {
        var info = infos[j] || {};
        if (String(info.filename) === filenames[i] && info.purl) {
          return {
            url: host + info.purl, headers: {}, mimeType: "audio/mpeg",
            expiresAtMs: Date.now() + 15 * 60 * 1000, trial: false, cacheable: true
          };
        }
      }
    }
    // 官方拿不到 purl(会员歌/无版权/未登录)时先试音源解锁,它关掉或没命中才报错。
    return unblock.resolve({
      songId: mid,
      songDetails: function () { return songDetails({ ids: [mid] }); }
    }).then(function (stream) {
      if (stream) return stream;
      return loadCookies().then(function (cookies) {
        throw new Error(musicKey(cookies)
          ? "歌曲暂无可用播放地址(可能是 VIP 歌曲或无版权)"
          : "需要登录:请到设置 → QQ音乐 → 登录(粘贴 QQ 音乐 Cookie)后播放");
      });
    });
  });
}

function lyrics(args) {
  var mid = String(args.id || "");
  if (!mid) return Promise.resolve({ assets: [] });
  // 明文 LRC(匿名可用)。QQ 的 QRC 解密结果也只是普通 LRC 的 XML 壳,无逐字时间轴。
  return httpGetJson(SEARCH_HOST + "/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid="
      + encodeURIComponent(mid) + "&format=json&nobase64=1&g_tk=5381",
      REF_LYRIC, UA_MOBILE).then(function (body) {
    var raw = body.lyric || "";
    if (!raw) return { assets: [] };
    return { assets: [{ format: "lrc", role: "original", text: raw }] };
  });
}

function account() {
  return Promise.all([loadCookies(), loadSession()]).then(function (both) {
    var cookies = both[0];
    var session = both[1] || {};
    var uin = musicUin(cookies);
    var key = musicKey(cookies);
    if (!key || uin === "0") return { loggedIn: false };
    // 扫码登录时服务端顺带回了昵称,粘贴/网页登录没有,所以昵称统一去用户资料
    // 接口取,拿不到才退回会话里的旧值,最后才是 QQ 号。
    var fallback = {
      loggedIn: true, id: uin,
      displayName: session.nick || ("QQ " + uin),
      avatarUrl: secureUrl(session.logo || ""),
      membershipTier: 0, level: 0, signature: ""
    };
    return musicu({
      info: {
        module: "userInfo.BaseUserInfoServer",
        method: "get_user_baseinfo_v2",
        param: { vec_uin: [uin] }
      },
      vip: {
        module: "userInfo.VipQueryServer",
        method: "SRFVipQuery_V2",
        param: { uin_list: [uin] }
      }
    }).then(function (body) {
      var profile = ((body.info && body.info.data || {}).map_userinfo || {})[uin] || {};
      var vip = ((body.vip && body.vip.data || {}).infoMap || {})[uin] || {};
      return {
        loggedIn: true, id: uin,
        displayName: profile.nick || fallback.displayName,
        avatarUrl: secureUrl(profile.headurl || session.logo || ""),
        // 宿主只用它区分普通/会员,超级会员单列一档。
        membershipTier: Number(vip.iSuperVip || 0) ? 2 : (Number(vip.iVipFlag || 0) ? 1 : 0),
        level: Number(vip.iCurLevel || 0),
        signature: profile.desc || profile.mark || ""
      };
    }, function () { return fallback; });
  });
}

/** 从微信登录页里取出本次会话的 uuid。 */
function wxBeginChallenge() {
  var query = "appid=" + WX_APPID
    + "&redirect_uri=" + encodeURIComponent("https://y.qq.com/portal/wx_redirect.html?login_type=2&surl=https://y.qq.com/")
    + "&response_type=code&scope=snsapi_login&state=STATE"
    + "&href=" + encodeURIComponent("https://y.qq.com/mediastyle/music_v17/src/css/popup_wechat.css#wechat_redirect");
  return httpGetText(WX_QRCONNECT + "?" + query, REF_WX, UA_PC).then(function (html) {
    var match = /uuid=([A-Za-z0-9_-]+)/.exec(html);
    if (!match) throw new Error("未能获取微信登录二维码");
    var uuid = match[1];
    return {
      id: uuid, methodId: "wxqr", status: "waiting",
      // 实测微信二维码图片编的就是这个串,所以宿主自己 encode 出来的码可以直接扫。
      qrContent: WX_CONFIRM + uuid,
      expiresAtMs: Date.now() + 5 * 60 * 1000
    };
  });
}

/** 用扫码换来的 code 换取 musickey,并落库成 cookie 形态 + 独立会话。 */
function wxAuthorize(code) {
  return httpPostJson(MUSICU, {
    comm: { tmeLoginType: 1, format: "json", inCharset: "utf-8", outCharset: "utf-8" },
    req_1: {
      module: "music.login.LoginServer", method: "Login",
      param: { code: code, strAppid: WX_APPID }
    }
  }, REF_BASE).then(function (body) {
    var data = body.req_1 && body.req_1.data || {};
    var key = String(data.musickey || "");
    var id = String(data.musicid || data.str_musicid || data.uin || "");
    if (!key || !id) throw new Error("微信登录未返回有效凭据");
    // "cookies" 只放 cookie 形态的字段 —— musicu() 会把它整份拼进 Cookie 头。
    var cookies = {
      uin: id, musicid: id, musickey: key, qqmusic_key: key, qm_keyst: key
    };
    var session = {
      loginType: Number(data.loginType || 1),
      refreshToken: String(data.refresh_token || ""),
      unionid: String(data.unionid || ""),
      nick: String(data.nick || data.nickname || ""),
      logo: String(data.logo || data.headurl || "")
    };
    return call("credentials.put", { key: "cookies", value: JSON.stringify(cookies) })
      .then(function () { return saveSession(session); })
      .then(function () {
        return {
          loggedIn: true, id: id,
          displayName: session.nick || ("QQ " + id),
          avatarUrl: session.logo, membershipTier: 0, level: 0, signature: ""
        };
      });
  });
}

function login(args) {
  switch (args.operation) {
    case "methods":
      return [{
        // QQ 号扫码只能走这里:ptqrshow 返回的是 PNG,二维码内容只存在于图像
        // 里,而宿主要的是一串文本。网页登录则把整个官方登录页交给系统 WebView,
        // QQ / 微信两种账号都能用。
        id: "web", type: "web", label: "QQ / 微信登录",
        instructions: "打开 QQ 音乐官方登录页，用 QQ 或微信登录后自动返回。",
        webUrl: "https://y.qq.com/portal/profile.html",
        cookieUrl: "https://y.qq.com",
        credentialCookieName: "qm_keyst"
      }, {
        id: "wxqr", type: "qr", label: "微信扫码",
        instructions: "用微信扫码并确认，即可登录绑定了该微信的 QQ 音乐账号。"
      }, {
        id: "cookie", type: "credential", label: "Cookie",
        instructions: "在 QQ 音乐客户端/网页登录后,复制含 musickey 的 Cookie(如抓包 qqmusic.music.qq.com 请求头)。" +
          "插件会提取 musickey 与 uin 并加密保存,用于 Vkey 播放。",
        credentialLabel: "QQ 音乐 Cookie"
      }];
    case "begin":
      if (args.methodId !== "wxqr") throw new Error("该登录方式不需要创建挑战");
      return wxBeginChallenge();
    case "poll": {
      var uuid = String(args.challengeId || "");
      if (!uuid) throw new Error("缺少登录挑战 ID");
      var waiting = { id: uuid, methodId: "wxqr", status: "waiting" };
      // 这是长轮询,未扫码时服务端会挂住约 15 秒才回 408;超时/网络抖动都按
      // "还在等" 处理,不能报失败,否则界面会在正常等待期间弹错。
      return httpGetText(WX_POLL + "?uuid=" + encodeURIComponent(uuid) + "&_=" + Date.now(),
          REF_WX, UA_PC, 25000).then(function (text) {
        var match = /window\.wx_errcode=(\d+);window\.wx_code='([^']*)'/.exec(text);
        if (!match) return waiting;
        var code = Number(match[1]);
        var wxCode = match[2];
        if (code === 404) return { id: uuid, methodId: "wxqr", status: "scanned" };
        if (code === 402 || code === 403) return { id: uuid, methodId: "wxqr", status: "expired" };
        if (code === 405 && wxCode) {
          return wxAuthorize(wxCode).then(function (profile) {
            return { id: uuid, methodId: "wxqr", status: "success", account: profile };
          }, function (error) {
            return { id: uuid, methodId: "wxqr", status: "failed",
              message: String(error && error.message || error) };
          });
        }
        return waiting;
      }, function () { return waiting; });
    }
    case "submit": {
      var cookieStr = String(args.credential || "");
      if (!cookieStr) return { methodId: args.methodId, status: "failed", message: "Cookie 为空" };
      var parsed = {};
      cookieStr.split(";").forEach(function (part) {
        var at = part.indexOf("=");
        if (at <= 0) return;
        var name = part.slice(0, at).trim();
        var value = part.slice(at + 1).trim();
        if (name) parsed[decodeURIComponent(name)] = decodeURIComponent(value);
      });
      var uin = musicUin(parsed);
      var key = musicKey(parsed);
      if (!key) {
        return { methodId: args.methodId, status: "failed",
          message: "Cookie 中找不到 musickey/qm_keyst/qqmusic_key" };
      }
      return call("credentials.put", { key: "cookies", value: JSON.stringify(parsed) })
        // 上一次扫码登录留下的 session 会用它自己的 loginType/昵称盖掉这份新
        // Cookie 的登录态,必须一起清掉。
        .then(function () { return call("credentials.delete", { key: "session" }); },
              function () { return call("credentials.delete", { key: "session" }); })
        .then(function () { return account(); }, function () { return null; })
        .then(function (profile) {
          return { methodId: args.methodId, status: "success",
            account: profile && profile.loggedIn ? profile
              : { loggedIn: true, id: uin, displayName: "QQ " + uin,
                  avatarUrl: "", membershipTier: 0, level: 0, signature: "" } };
        });
    }
    case "logout":
      return call("credentials.delete", { key: "cookies" })
        .then(function () { return call("credentials.delete", { key: "session" }); },
              function () { return call("credentials.delete", { key: "session" }); })
        .then(function () { return true; }, function () { return true; });
    default:
      throw new Error("未知登录操作");
  }
}

var unblock = require("./unblock");

module.exports = {
  handlers: {
    searchSongs: searchSongs,
    songDetails: songDetails,
    playlistDetails: playlistDetails,
    artistDetails: artistDetails,
    albumDetails: albumDetails,
    home: home,
    userPlaylists: userPlaylists,
    resolveStream: resolveStream,
    lyrics: lyrics,
    account: account,
    like: like,
    playlistMutation: playlistMutation,
    login: login,
    "ui.unblock": unblock.ui
  }
};
