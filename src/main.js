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
var qrcDecrypt = require("./qrc").qrcDecrypt;

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

/** musicu.fcg 批量请求;带登录 cookie 时使用真实 uin 与 musickey。 */
function musicu(entries) {
  return loadCookies().then(function (cookies) {
    var key = musicKey(cookies);
    var uin = key ? musicUin(cookies) : "0";
    var gtkValue = gtk(key);
    var comm = {
      cv: 4747474, ct: 24, format: "json", inCharset: "utf-8", outCharset: "utf-8",
      notice: 0, platform: "yqq.json", needNewCode: 1, uin: uin,
      g_tk: gtkValue, g_tk_new_20200303: gtkValue
    };
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

function songDto(raw) {
  raw = raw || {};
  var album = raw.album || {};
  var mid = raw.songmid || raw.mid || "";
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

function playlistDto(raw) {
  raw = raw || {};
  return {
    id: String(raw.content_id || raw.tid || raw.id || ""),
    name: raw.title || raw.name || "",
    description: raw.desc || "",
    artworkUrl: secureUrl(raw.cover || raw.picUrl || ""),
    owner: null,
    trackCount: Number(raw.song_cnt || raw.total_song_num || 0),
    playCount: Number(raw.access_num || raw.play_count || 0),
    subscribed: false, owned: false
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
    return loadCookies().then(function (cookies) {
      throw new Error(musicKey(cookies)
        ? "歌曲暂无可用播放地址(可能是 VIP 歌曲或无版权)"
        : "需要登录:请到设置 → QQ音乐 → 登录(粘贴 QQ 音乐 Cookie)后播放");
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
  return loadCookies().then(function (cookies) {
    var uin = musicUin(cookies);
    var key = musicKey(cookies);
    if (!key || uin === "0") return { loggedIn: false };
    return {
      loggedIn: true, id: uin, displayName: "QQ " + uin,
      avatarUrl: "", membershipTier: 0, level: 0, signature: ""
    };
  });
}

function login(args) {
  switch (args.operation) {
    case "methods":
      return [{
        id: "cookie", type: "credential", label: "Cookie",
        instructions: "在 QQ 音乐客户端/网页登录后,复制含 musickey 的 Cookie(如抓包 qqmusic.music.qq.com 请求头)。" +
          "插件会提取 musickey 与 uin 并加密保存,用于 Vkey 播放。",
        credentialLabel: "QQ 音乐 Cookie"
      }];
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
      return call("credentials.put", { key: "cookies", value: JSON.stringify(parsed) }).then(function () {
        return { methodId: args.methodId, status: "success",
          account: { loggedIn: true, id: uin, displayName: "QQ " + uin,
            avatarUrl: "", membershipTier: 0, level: 0, signature: "" } };
      });
    }
    case "logout":
      return call("credentials.delete", { key: "cookies" }).then(function () { return true; });
    default:
      throw new Error("未知登录操作");
  }
}

module.exports = {
  handlers: {
    searchSongs: searchSongs,
    songDetails: songDetails,
    artistDetails: artistDetails,
    albumDetails: albumDetails,
    home: home,
    resolveStream: resolveStream,
    lyrics: lyrics,
    account: account,
    login: login
  }
};
