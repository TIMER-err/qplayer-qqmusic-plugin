"use strict";

function call(method, args) { return qplayer.call(method, args || {}); }

var GD_API = "https://music-api.gdstudio.xyz/api.php";
var KUWO_PACKAGE = "kwplayer_ar_5.1.0.0_B_jiakong_vh.apk";
var BODIAN_AUDIO_PATH = "/api/play/music/v2/audioUrl";
var STORAGE_KEY = "unblockEnabled";

function text(value) { return String(value == null ? "" : value); }

function httpGet(url, headers, timeoutMs) {
  return call("http.request", {
    url: url, method: "GET", headers: headers || {}, timeoutMs: timeoutMs || 8000
  }).then(function (response) {
    if (!response || response.status < 200 || response.status >= 300) return null;
    return text(response.body);
  }, function () { return null; });
}

function httpPost(url, body, contentType, headers) {
  return call("http.request", {
    url: url, method: "POST",
    headers: Object.assign({"Content-Type": contentType || "application/json"}, headers || {}),
    body: body, timeoutMs: 8000
  }).then(function () { return true; }, function () { return false; });
}

function parseJson(body) {
  try { return JSON.parse(body); } catch (_) { return null; }
}

function enabled() {
  return call("storage.get", {key: STORAGE_KEY}).then(function (value) {
    return value !== false;
  }, function () { return true; });
}

function setEnabled(value) {
  return call("storage.put", {key: STORAGE_KEY, value: !!value});
}

function notify(message) {
  return call("notifications.toast", {message: message}).then(function () { return true; },
      function () { return false; });
}

function normalizeName(name) {
  return text(name).toLowerCase().replace(/[（(][^）)]*[）)]/g, "").trim();
}

function normalizeArtist(artist) {
  return text(artist).toLowerCase().replace(/[&/、，,;；]/g, " ").replace(/\s+/g, " ").trim();
}

function isMatch(resultName, resultArtist, wantName, wantArtist) {
  var rn = normalizeName(resultName);
  if (!rn) return false;
  var on = normalizeName(wantName);
  if (on && rn.indexOf(on) < 0 && on.indexOf(rn) < 0) return false;
  if (resultArtist && wantArtist) {
    var ra = normalizeArtist(resultArtist);
    var oa = normalizeArtist(wantArtist);
    if (ra && oa && ra.indexOf(oa) < 0 && oa.indexOf(ra) < 0) return false;
  }
  return true;
}

/**
 * gdstudio 只能按它自己音源的 id 取址,拿 QQ 的 songmid 去问会直接 400,
 * 所以这里先用关键词搜出对应 id 再取址。source=tencent/qq 均不受支持,
 * 实测可用的是 netease 与 joox(kuwo 能搜到但取址返回空)。
 */
function gdstudioOne(source, keyword, songName, artist) {
  return httpGet(GD_API + "?types=search&source=" + source
      + "&name=" + encodeURIComponent(keyword) + "&count=20&pages=1",
      {"User-Agent": "qplayer/1.0"}).then(function (body) {
    var list = parseJson(body);
    if (!list || !list.length) return null;
    for (var i = 0; i < list.length; i++) {
      var item = list[i] || {};
      var names = item.artist;
      var credited = Object.prototype.toString.call(names) === "[object Array]"
          ? names.join(" ") : text(names);
      if (!isMatch(item.name, credited, songName, artist)) continue;
      if (!item.id) continue;
      return httpGet(GD_API + "?types=url&source=" + source
          + "&id=" + encodeURIComponent(String(item.id)) + "&br=320",
          {"User-Agent": "qplayer/1.0"}).then(function (urlBody) {
        var obj = parseJson(urlBody);
        var url = obj && obj.url;
        return url ? String(url) : null;
      });
    }
    return null;
  }, function () { return null; });
}

function gdstudio(keyword, songName, artist) {
  if (!keyword) return Promise.resolve(null);
  return firstUrl([
    function () { return gdstudioOne("netease", keyword, songName, artist); },
    function () { return gdstudioOne("joox", keyword, songName, artist); }
  ]);
}

function kuwoSearchRid(keyword, songName, artist) {
  var url = "http://search.kuwo.cn/r.s?&correct=1&stype=comprehensive&encoding=utf8"
      + "&rformat=json&mobi=1&show_copyright_off=1&searchapi=6&all="
      + encodeURIComponent(keyword).replace(/%20/g, "%20");
  return httpGet(url).then(function (body) {
    var root = parseJson(body);
    var content = root && root.content;
    if (!content || content.length < 2) return null;
    var list = content[1] && content[1].musicpage && content[1].musicpage.abslist;
    if (!list || !list.length) return null;
    for (var i = 0; i < list.length; i++) {
      var item = list[i] || {};
      var musicRid = text(item.MUSICRID);
      if (!musicRid) continue;
      if (isMatch(item.SONGNAME, item.ARTIST, songName, artist)) {
        return musicRid.indexOf("MUSIC_") === 0 ? musicRid.slice(6) : musicRid;
      }
    }
    return null;
  }, function () { return null; });
}

function kuwo(keyword, songName, artist) {
  if (!keyword) return Promise.resolve(null);
  return kuwoSearchRid(keyword, songName, artist).then(function (rid) {
    if (!rid) return null;
    var query = "corp=kuwo&source=" + KUWO_PACKAGE + "&p2p=1&type=convert_url2&sig=0&format=mp3&rid=" + rid;
    return httpGet("http://mobi.kuwo.cn/mobi.s?f=kuwo&q=" + encryptQuery(query), {
      "User-Agent": "okhttp/3.10.0"
    }).then(function (body) {
      var match = text(body).match(/http[^\s$"]+/);
      return match ? match[0] : null;
    });
  }, function () { return null; });
}

function bodianSearchRid(keyword, songName, artist) {
  var kw = text(keyword).replace(" - ", " ");
  var url = "http://search.kuwo.cn/r.s?&correct=1&vipver=1&stype=comprehensive&encoding=utf8"
      + "&rformat=json&mobi=1&show_copyright_off=1&searchapi=6&all="
      + encodeURIComponent(kw);
  return httpGet(url).then(function (body) {
    var root = parseJson(body);
    var content = root && root.content;
    if (!content || content.length < 2) return null;
    var list = content[1] && content[1].musicpage && content[1].musicpage.abslist;
    if (!list || !list.length) return null;
    for (var i = 0; i < list.length; i++) {
      var item = list[i] || {};
      var musicRid = text(item.MUSICRID);
      if (!musicRid) continue;
      if (isMatch(item.SONGNAME, item.ARTIST, songName, artist)) {
        var at = musicRid.lastIndexOf("_");
        return at >= 0 ? musicRid.slice(at + 1) : musicRid;
      }
    }
    return null;
  }, function () { return null; });
}

function bodianSign(url) {
  var stamped = url + "&timestamp=" + Date.now();
  var query = stamped.slice(stamped.indexOf("?") + 1).replace(/[^a-zA-Z0-9]/g, "");
  var chars = query.split("").sort().join("");
  var data = "kuwotest" + chars + BODIAN_AUDIO_PATH;
  return call("crypto.digest", {algorithm: "MD5", data: data, outputEncoding: "hex"})
      .then(function (sign) { return stamped + "&sign=" + sign; });
}

function bodianHeaders() {
  return {
    "user-agent": "Dart/2.19 (dart:io)",
    plat: "ar",
    channel: "aliopen",
    devid: "48291736401",
    ver: "3.9.0",
    host: "bd-api.kuwo.cn"
  };
}

function bodian(keyword, songName, artist) {
  if (!keyword) return Promise.resolve(null);
  return bodianSearchRid(keyword, songName, artist).then(function (rid) {
    if (!rid) return null;
    var adUrl = "http://bd-api.kuwo.cn/api/service/advert/watch"
        + "?uid=-1&token=&timestamp=1724306124436&sign=15a676d66285117ad714e8c8371691da";
    var headers = bodianHeaders();
    headers.qimei36 = "1e9970cbcdc20a031dee9f37100017e1840e";
    return httpPost(adUrl, "{\"type\":5,\"subType\":5,\"musicId\":0,\"adToken\":\"\"}",
        "application/json; charset=utf-8", headers).then(function () {
      return bodianSign("http://bd-api.kuwo.cn/api/play/music/v2/audioUrl?&br=320kmp3&musicId=" + rid);
    }).then(function (audioUrl) {
      return httpGet(audioUrl, bodianHeaders());
    }).then(function (body) {
      var obj = parseJson(body);
      var url = obj && obj.data && obj.data.audioUrl;
      return url ? String(url) : null;
    });
  }, function () { return null; });
}

function firstUrl(promises) {
  function next(i) {
    if (i >= promises.length) return Promise.resolve(null);
    return promises[i]().then(function (url) {
      return url ? url : next(i + 1);
    }, function () { return next(i + 1); });
  }
  return next(0);
}

/**
 * 找不到替代音源时返回 null,由调用方决定报什么错 —— QQ 侧的提示要区分
 * "未登录" 和 "已登录但无版权",那个判断留在 main.js 里。
 *
 * 三个源都得靠 "歌名-歌手" 关键词(QQ 的 songmid 对它们毫无意义),
 * 所以先取一次歌曲详情,再按 bodian → kuwo → gdstudio 依次尝试。
 * bodian/kuwo 走的是酷我曲库,QQ 上的会员大户(如周杰伦)基本都在;
 * gdstudio 主要靠网易曲库,放最后兜底。
 */
function resolve(options) {
  var loadSong = options.songDetails;
  return enabled().then(function (on) {
    if (!on) return null;
    return loadSong().then(function (songs) {
      var song = songs && songs[0] || {};
      var name = song.title || song.name || "";
      var artist = song.artist || "";
      if (!artist && song.artists && song.artists.length) {
        var parts = [];
        for (var i = 0; i < song.artists.length; i++) {
          if (song.artists[i] && song.artists[i].name) parts.push(song.artists[i].name);
        }
        artist = parts.join(" ");
      }
      if (!name) return null;
      var keyword = artist ? name + "-" + artist : name;
      return firstUrl([
        function () { return bodian(keyword, name, artist); },
        function () { return kuwo(keyword, name, artist); },
        function () { return gdstudio(keyword, name, artist); }
      ]);
    }, function () { return null; });
  }).then(function (url) {
    if (!url) return null;
    notify("已为该歌曲自动换源");
    return {
      url: String(url),
      headers: {}, mimeType: "",
      expiresAtMs: Date.now() + 15 * 60 * 1000,
      trial: false, cacheable: true
    };
  });
}

function ui(args) {
  var action = args && args.action;
  var next = Promise.resolve();
  if (action === "enable") next = setEnabled(true);
  if (action === "disable") next = setEnabled(false);
  return next.then(enabled).then(function (on) {
    return {
      title: "音源解锁",
      subtitle: "QQ 音乐",
      icon: "lock_open",
      body: [
        {type: "text", style: "body",
          text: "QQ 官方无版权、或需要会员而拿不到播放地址时，自动依次尝试其他音源。"},
        {type: "text", style: "caption", text: on ? "当前：已开启" : "当前：已关闭"},
        {type: "row", items: [
          {type: "button", id: "enable", label: "开启", style: on ? "filled" : "outlined"},
          {type: "button", id: "disable", label: "关闭", style: on ? "outlined" : "filled"}
        ]}
      ]
    };
  });
}

var ARR_E = [
  31, 0, 1, 2, 3, 4, -1, -1, 3, 4, 5, 6, 7, 8, -1, -1,
  7, 8, 9, 10, 11, 12, -1, -1, 11, 12, 13, 14, 15, 16, -1, -1,
  15, 16, 17, 18, 19, 20, -1, -1, 19, 20, 21, 22, 23, 24, -1, -1,
  23, 24, 25, 26, 27, 28, -1, -1, 27, 28, 29, 30, 31, 30, -1, -1
];
var ARR_IP = [
  57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
  61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
  56, 48, 40, 32, 24, 16, 8, 0, 58, 50, 42, 34, 26, 18, 10, 2,
  60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6
];
var ARR_IP_1 = [
  39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22, 62, 30,
  37, 5, 45, 13, 53, 21, 61, 29, 36, 4, 44, 12, 52, 20, 60, 28,
  35, 3, 43, 11, 51, 19, 59, 27, 34, 2, 42, 10, 50, 18, 58, 26,
  33, 1, 41, 9, 49, 17, 57, 25, 32, 0, 40, 8, 48, 16, 56, 24
];
var ARR_LS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
var ARR_LS_MASK_LO = [0, 0x100001, 0x300003];
var ARR_P = [
  15, 6, 19, 20, 28, 11, 27, 16, 0, 14, 22, 25, 4, 17, 30, 9,
  1, 7, 23, 13, 31, 26, 2, 8, 18, 12, 29, 5, 21, 10, 3, 24
];
var ARR_PC_1 = [
  56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1,
  58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 62, 54, 46, 38,
  30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36,
  28, 20, 12, 4, 27, 19, 11, 3
];
var ARR_PC_2 = [
  13, 16, 10, 23, 0, 4, -1, -1, 2, 27, 14, 5, 20, 9, -1, -1,
  22, 18, 11, 3, 25, 7, -1, -1, 15, 6, 26, 19, 12, 1, -1, -1,
  40, 51, 30, 36, 46, 54, -1, -1, 29, 39, 50, 44, 32, 47, -1, -1,
  43, 48, 38, 55, 33, 52, -1, -1, 45, 41, 49, 35, 28, 31, -1, -1
];
var NS_BOX = [
  [14, 4, 3, 15, 2, 13, 5, 3, 13, 14, 6, 9, 11, 2, 0, 5, 4, 1, 10, 12, 15, 6, 9, 10, 1, 8,
   12, 7, 8, 11, 7, 0, 0, 15, 10, 5, 14, 4, 9, 10, 7, 8, 12, 3, 13, 1, 3, 6, 15, 12, 6, 11,
   2, 9, 5, 0, 4, 2, 11, 14, 1, 7, 8, 13],
  [15, 0, 9, 5, 6, 10, 12, 9, 8, 7, 2, 12, 3, 13, 5, 2, 1, 14, 7, 8, 11, 4, 0, 3, 14, 11,
   13, 6, 4, 1, 10, 15, 3, 13, 12, 11, 15, 3, 6, 0, 4, 10, 1, 7, 8, 4, 11, 14, 13, 8, 0, 6,
   2, 15, 9, 5, 7, 1, 10, 12, 14, 2, 5, 9],
  [10, 13, 1, 11, 6, 8, 11, 5, 9, 4, 12, 2, 15, 3, 2, 14, 0, 6, 13, 1, 3, 15, 4, 10, 14, 9,
   7, 12, 5, 0, 8, 7, 13, 1, 2, 4, 3, 6, 12, 11, 0, 13, 5, 14, 6, 8, 15, 2, 7, 10, 8, 15, 4,
   9, 11, 5, 9, 0, 14, 3, 10, 7, 1, 12],
  [7, 10, 1, 15, 0, 12, 11, 5, 14, 9, 8, 3, 9, 7, 4, 8, 13, 6, 2, 1, 6, 11, 12, 2, 3, 0, 5,
   14, 10, 13, 15, 4, 13, 3, 4, 9, 6, 10, 1, 12, 11, 0, 2, 5, 0, 13, 14, 2, 8, 15, 7, 4, 15,
   1, 10, 7, 5, 6, 12, 11, 3, 8, 9, 14],
  [2, 4, 8, 15, 7, 10, 13, 6, 4, 1, 3, 12, 11, 7, 14, 0, 12, 2, 5, 9, 10, 13, 0, 3, 1, 11,
   15, 5, 6, 8, 9, 14, 14, 11, 5, 6, 4, 1, 3, 10, 2, 12, 15, 0, 13, 2, 8, 5, 11, 8, 0, 15, 7,
   14, 9, 4, 12, 7, 10, 9, 1, 13, 6, 3],
  [12, 9, 0, 7, 9, 2, 14, 1, 10, 15, 3, 4, 6, 12, 5, 11, 1, 14, 13, 0, 2, 8, 7, 13, 15, 5, 4,
   10, 8, 3, 11, 6, 10, 4, 6, 11, 7, 9, 0, 6, 4, 2, 13, 1, 9, 15, 3, 8, 15, 3, 1, 14, 12, 5,
   11, 0, 2, 12, 14, 7, 5, 10, 8, 13],
  [4, 1, 3, 10, 15, 12, 5, 0, 2, 11, 9, 6, 8, 7, 6, 9, 11, 4, 12, 15, 0, 3, 10, 5, 14, 13, 7,
   8, 13, 14, 1, 2, 13, 6, 14, 9, 4, 1, 2, 14, 11, 13, 5, 0, 1, 10, 8, 3, 0, 11, 3, 5, 9, 4,
   15, 2, 7, 8, 12, 15, 10, 7, 6, 12],
  [13, 7, 10, 0, 6, 9, 5, 15, 8, 4, 3, 10, 11, 14, 12, 5, 2, 11, 9, 6, 15, 12, 0, 3, 4, 1,
   14, 13, 1, 2, 7, 8, 1, 2, 12, 15, 10, 4, 0, 3, 13, 14, 6, 9, 7, 8, 9, 6, 15, 1, 5, 12, 3,
   10, 14, 5, 8, 7, 11, 0, 4, 13, 2, 11]
];

function pair(lo, hi) { return {lo: lo >>> 0, hi: hi >>> 0}; }
function hasBit(value, i) {
  return i < 32 ? ((value.lo >>> i) & 1) : ((value.hi >>> (i - 32)) & 1);
}
function orBit(value, i) {
  if (i < 32) value.lo = (value.lo | (1 << i)) >>> 0;
  else value.hi = (value.hi | (1 << (i - 32))) >>> 0;
}
function bitTransform(arr, n, value) {
  var out = pair(0, 0);
  for (var i = 0; i < n; i++) {
    if (arr[i] >= 0 && hasBit(value, arr[i])) orBit(out, i);
  }
  return out;
}
function and64(a, b) { return pair(a.lo & b.lo, a.hi & b.hi); }
function or64(a, b) { return pair(a.lo | b.lo, a.hi | b.hi); }
function not64(a) { return pair(~a.lo, ~a.hi); }
function shl64(a, n) {
  if (n <= 0) return pair(a.lo, a.hi);
  if (n >= 64) return pair(0, 0);
  if (n >= 32) return pair(0, (a.lo << (n - 32)) >>> 0);
  return pair((a.lo << n) >>> 0, ((a.hi << n) | (a.lo >>> (32 - n))) >>> 0);
}
function shr64(a, n) {
  if (n <= 0) return pair(a.lo, a.hi);
  if (n >= 64) return pair(0, 0);
  if (n >= 32) return pair(a.hi >>> (n - 32), 0);
  return pair(((a.lo >>> n) | (a.hi << (32 - n))) >>> 0, a.hi >>> n);
}

function des64(keys, block) {
  var permuted = bitTransform(ARR_IP, 64, block);
  var left = permuted.lo;
  var right = permuted.hi;
  var pR = [0, 0, 0, 0, 0, 0, 0, 0];
  for (var i = 0; i < 16; i++) {
    var expanded = bitTransform(ARR_E, 64, pair(right, 0));
    var mixed = pair(expanded.lo ^ keys[i].lo, expanded.hi ^ keys[i].hi);
    for (var j = 0; j < 8; j++) {
      if (j < 4) pR[j] = (mixed.lo >>> (j * 8)) & 255;
      else pR[j] = (mixed.hi >>> ((j - 4) * 8)) & 255;
    }
    var sOut = 0;
    for (var sbi = 7; sbi >= 0; sbi--) sOut = ((sOut << 4) | NS_BOX[sbi][pR[sbi]]) >>> 0;
    var r = bitTransform(ARR_P, 32, pair(sOut, 0)).lo;
    var next = (left ^ r) >>> 0;
    left = right;
    right = next;
  }
  return bitTransform(ARR_IP_1, 64, pair(right, left));
}

function subKeys(key, mode) {
  var rotated = bitTransform(ARR_PC_1, 56, key);
  var keys = [];
  for (var i = 0; i < 16; i++) {
    var shift = ARR_LS[i];
    var mask = pair(ARR_LS_MASK_LO[shift], 0);
    rotated = or64(shl64(and64(rotated, mask), 28 - shift), shr64(and64(rotated, not64(mask)), shift));
    keys[i] = bitTransform(ARR_PC_2, 64, rotated);
  }
  if (mode === 1) {
    for (var j = 0; j < 8; j++) {
      var tmp = keys[j];
      keys[j] = keys[15 - j];
      keys[15 - j] = tmp;
    }
  }
  return keys;
}

function bytesToPair(bytes, offset) {
  var lo = 0, hi = 0;
  for (var i = 0; i < 4; i++) lo = (lo | ((bytes[offset + i] & 255) << (i * 8))) >>> 0;
  for (var i = 0; i < 4; i++) hi = (hi | ((bytes[offset + 4 + i] & 255) << (i * 8))) >>> 0;
  return pair(lo, hi);
}

function pairToBytes(value, out, offset) {
  for (var i = 0; i < 4; i++) out[offset + i] = (value.lo >>> (i * 8)) & 255;
  for (var i = 0; i < 4; i++) out[offset + 4 + i] = (value.hi >>> (i * 8)) & 255;
}

function crypt(msg, keyBytes) {
  var key = bytesToPair(keyBytes, 0);
  var keys = subKeys(key, 0);
  var blocks = Math.floor(msg.length / 8);
  var rem = msg.length % 8;
  var count = blocks + ((rem > 0) ? 1 : 1);
  var out = [];
  for (var i = 0; i < blocks; i++) out[i] = des64(keys, bytesToPair(msg, i * 8));
  var tail = pair(0, 0);
  for (var n = 0; n < rem; n++) {
    var shift = n * 8;
    if (shift < 32) tail.lo = (tail.lo | ((msg[blocks * 8 + n] & 255) << shift)) >>> 0;
    else tail.hi = (tail.hi | ((msg[blocks * 8 + n] & 255) << (shift - 32))) >>> 0;
  }
  out[blocks] = des64(keys, tail);
  var result = [];
  for (var b = 0; b < out.length; b++) pairToBytes(out[b], result, b * 8);
  return result;
}

function utf8Bytes(value) {
  var encoded = unescape(encodeURIComponent(String(value)));
  var bytes = [];
  for (var i = 0; i < encoded.length; i++) bytes.push(encoded.charCodeAt(i) & 255);
  return bytes;
}

function base64(bytes) {
  var table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var out = "";
  for (var i = 0; i < bytes.length; i += 3) {
    var a = bytes[i];
    var b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    var c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += table.charAt((a >> 2) & 63);
    out += table.charAt(((a & 3) << 4) | ((b >> 4) & 15));
    out += i + 1 < bytes.length ? table.charAt(((b & 15) << 2) | ((c >> 6) & 3)) : "=";
    out += i + 2 < bytes.length ? table.charAt(c & 63) : "=";
  }
  return out;
}

function encryptQuery(query) {
  var key = utf8Bytes("ylzsxkwm");
  return base64(crypt(utf8Bytes(query), key));
}

module.exports = {resolve: resolve, ui: ui};
