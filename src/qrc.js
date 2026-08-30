"use strict";

// QRC 歌词解密(Melodify QrcDecryptor 移植):hex → 3DES(自定义 S-box 的 DES)→ zlib inflate → UTF-8。
// 纯 JS 实现,不依赖宿主 crypto(宿主没有 DES 与 zlib)。

var KEY = (function () {
  var s = "!@#)(*$%123ZXC!@!@#)(NHL";
  var out = [];
  for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
  return out;
})();

var S_BOX = [
  [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
  [15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,15,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
  [10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
  [7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,10,13,8,9,4,5,11,12,7,2,14],
  [2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
  [12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
  [4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
  [13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11]
];

// ---- bit helpers (Java 位语义:32 位有符号 + 无符号右移) ----

function bn(a, b, c) {
  var byteIdx = ((b / 32) | 0) * 4 + 3 - ((b % 32) / 8) | 0;
  return (((a[byteIdx] & 0xff) >>> (7 - (b % 8))) & 1) << c;
}

function bni(a, b, c) {
  return ((a >>> (31 - b)) & 1) << c;
}

function bnl(a, b, c) {
  return ((a << b) & 0x80000000) >>> c;
}

function sBit(a) {
  var v = a & 0xff;
  return (v & 32) | ((v & 31) >> 1) | ((v & 1) << 4);
}

// ---- DES core (Melodify QrcDecryptor 逐行移植) ----

function initialPermutation(inBytes) {
  var s0 = bn(inBytes,57,31)|bn(inBytes,49,30)|bn(inBytes,41,29)|bn(inBytes,33,28)|
           bn(inBytes,25,27)|bn(inBytes,17,26)|bn(inBytes, 9,25)|bn(inBytes, 1,24)|
           bn(inBytes,59,23)|bn(inBytes,51,22)|bn(inBytes,43,21)|bn(inBytes,35,20)|
           bn(inBytes,27,19)|bn(inBytes,19,18)|bn(inBytes,11,17)|bn(inBytes, 3,16)|
           bn(inBytes,61,15)|bn(inBytes,53,14)|bn(inBytes,45,13)|bn(inBytes,37,12)|
           bn(inBytes,29,11)|bn(inBytes,21,10)|bn(inBytes,13, 9)|bn(inBytes, 5, 8)|
           bn(inBytes,63, 7)|bn(inBytes,55, 6)|bn(inBytes,47, 5)|bn(inBytes,39, 4)|
           bn(inBytes,31, 3)|bn(inBytes,23, 2)|bn(inBytes,15, 1)|bn(inBytes, 7, 0);
  var s1 = bn(inBytes,56,31)|bn(inBytes,48,30)|bn(inBytes,40,29)|bn(inBytes,32,28)|
           bn(inBytes,24,27)|bn(inBytes,16,26)|bn(inBytes, 8,25)|bn(inBytes, 0,24)|
           bn(inBytes,58,23)|bn(inBytes,50,22)|bn(inBytes,42,21)|bn(inBytes,34,20)|
           bn(inBytes,26,19)|bn(inBytes,18,18)|bn(inBytes,10,17)|bn(inBytes, 2,16)|
           bn(inBytes,60,15)|bn(inBytes,52,14)|bn(inBytes,44,13)|bn(inBytes,36,12)|
           bn(inBytes,28,11)|bn(inBytes,20,10)|bn(inBytes,12, 9)|bn(inBytes, 4, 8)|
           bn(inBytes,62, 7)|bn(inBytes,54, 6)|bn(inBytes,46, 5)|bn(inBytes,38, 4)|
           bn(inBytes,30, 3)|bn(inBytes,22, 2)|bn(inBytes,14, 1)|bn(inBytes, 6, 0);
  return [s0, s1];
}

function inversePermutation(s0, s1) {
  var d = new Array(8);
  d[3] = (bni(s1,7,7)|bni(s0,7,6)|bni(s1,15,5)|bni(s0,15,4)|bni(s1,23,3)|bni(s0,23,2)|bni(s1,31,1)|bni(s0,31,0));
  d[2] = (bni(s1,6,7)|bni(s0,6,6)|bni(s1,14,5)|bni(s0,14,4)|bni(s1,22,3)|bni(s0,22,2)|bni(s1,30,1)|bni(s0,30,0));
  d[1] = (bni(s1,5,7)|bni(s0,5,6)|bni(s1,13,5)|bni(s0,13,4)|bni(s1,21,3)|bni(s0,21,2)|bni(s1,29,1)|bni(s0,29,0));
  d[0] = (bni(s1,4,7)|bni(s0,4,6)|bni(s1,12,5)|bni(s0,12,4)|bni(s1,20,3)|bni(s0,20,2)|bni(s1,28,1)|bni(s0,28,0));
  d[7] = (bni(s1,3,7)|bni(s0,3,6)|bni(s1,11,5)|bni(s0,11,4)|bni(s1,19,3)|bni(s0,19,2)|bni(s1,27,1)|bni(s0,27,0));
  d[6] = (bni(s1,2,7)|bni(s0,2,6)|bni(s1,10,5)|bni(s0,10,4)|bni(s1,18,3)|bni(s0,18,2)|bni(s1,26,1)|bni(s0,26,0));
  d[5] = (bni(s1,1,7)|bni(s0,1,6)|bni(s1, 9,5)|bni(s0, 9,4)|bni(s1,17,3)|bni(s0,17,2)|bni(s1,25,1)|bni(s0,25,0));
  d[4] = (bni(s1,0,7)|bni(s0,0,6)|bni(s1, 8,5)|bni(s0, 8,4)|bni(s1,16,3)|bni(s0,16,2)|bni(s1,24,1)|bni(s0,24,0));
  return d;
}

function f(state, key6) {
  var t1 = bnl(state,31, 0)|((state & 0xf0000000)>>> 1)|bnl(state, 4,5)|
           bnl(state, 3, 6)|((state & 0x0f000000)>>> 3)|bnl(state, 8,11)|
           bnl(state, 7,12)|((state & 0x00f00000)>>> 5)|bnl(state,12,17)|
           bnl(state,11,18)|((state & 0x000f0000)>>> 7)|bnl(state,16,23);
  var t2 = bnl(state,15, 0)|((state & 0x0000f000)<<15)|bnl(state,20, 5)|
           bnl(state,19, 6)|((state & 0x00000f00)<<13)|bnl(state,24,11)|
           bnl(state,23,12)|((state & 0x000000f0)<<11)|bnl(state,28,17)|
           bnl(state,27,18)|((state & 0x0000000f)<< 9)|bnl(state, 0,23);
  var lrg = [(t1>>>24)&0xff,(t1>>>16)&0xff,(t1>>>8)&0xff,(t2>>>24)&0xff,(t2>>>16)&0xff,(t2>>>8)&0xff];
  for (var i = 0; i < 6; i++) lrg[i] ^= (key6[i] & 0xff);
  state =
    ((S_BOX[0][sBit(lrg[0]>>>2)] & 0xF)<<28) |
    ((S_BOX[1][sBit((((lrg[0]&3)<<4)|((lrg[1]&0xff)>>>4)))] & 0xF)<<24) |
    ((S_BOX[2][sBit((((lrg[1]&0xF)<<2)|((lrg[2]&0xff)>>>6)))] & 0xF)<<20) |
    ((S_BOX[3][sBit(lrg[2]&0x3F)] & 0xF)<<16) |
    ((S_BOX[4][sBit(lrg[3]>>>2)] & 0xF)<<12) |
    ((S_BOX[5][sBit((((lrg[3]&3)<<4)|((lrg[4]&0xff)>>>4)))] & 0xF)<<8) |
    ((S_BOX[6][sBit((((lrg[4]&0xF)<<2)|((lrg[5]&0xff)>>>6)))] & 0xF)<<4) |
    (S_BOX[7][sBit(lrg[5]&0x3F)] & 0xF);
  return bnl(state,15, 0)|bnl(state, 6, 1)|bnl(state,19, 2)|bnl(state,20, 3)|
         bnl(state,28, 4)|bnl(state,11, 5)|bnl(state,27, 6)|bnl(state,16, 7)|
         bnl(state, 0, 8)|bnl(state,14, 9)|bnl(state,22,10)|bnl(state,25,11)|
         bnl(state, 4,12)|bnl(state,17,13)|bnl(state,30,14)|bnl(state, 9,15)|
         bnl(state, 1,16)|bnl(state, 7,17)|bnl(state,23,18)|bnl(state,13,19)|
         bnl(state,31,20)|bnl(state,26,21)|bnl(state, 2,22)|bnl(state, 8,23)|
         bnl(state,18,24)|bnl(state,12,25)|bnl(state,29,26)|bnl(state, 5,27)|
         bnl(state,21,28)|bnl(state,10,29)|bnl(state, 3,30)|bnl(state,24,31);
}

function keySchedule(fullKey, keyOffset, encrypt) {
  var rndShift = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1];
  var permC = [56,48,40,32,24,16,8,0,57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35];
  var permD = [62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,60,52,44,36,28,20,12,4,27,19,11,3];
  var comp = [13,16,10,23,0,4,2,27,14,5,20,9,22,18,11,3,25,7,15,6,26,19,12,1,
              40,51,30,36,46,54,29,39,50,44,32,47,43,48,38,55,33,52,45,41,49,35,28,31];
  var k = fullKey.slice(keyOffset, keyOffset + 8);
  var c = 0, d = 0;
  for (var i = 0; i < 28; i++) {
    c |= bn(k, permC[i], 31 - i);
    d |= bn(k, permD[i], 31 - i);
  }
  var schedule = [];
  for (var r = 0; r < 16; r++) schedule.push([0, 0, 0, 0, 0, 0]);
  for (var r2 = 0; r2 < 16; r2++) {
    var shift = rndShift[r2];
    c = ((c << shift) | (c >>> (28 - shift))) & 0xfffffff0;
    d = ((d << shift) | (d >>> (28 - shift))) & 0xfffffff0;
    var toGen = encrypt ? r2 : (15 - r2);
    for (var j = 0; j < 24; j++)
      schedule[toGen][(j / 8) | 0] |= bni(c, comp[j], 7 - (j % 8));
    for (var j2 = 24; j2 < 48; j2++)
      schedule[toGen][(j2 / 8) | 0] |= bni(d, comp[j2] - 27, 7 - (j2 % 8));
  }
  return schedule;
}

function desCrypt(input, keyScheduleTable) {
  var ip = initialPermutation(input);
  var s0 = ip[0], s1 = ip[1];
  for (var i = 0; i < 15; i++) {
    var prev = s1;
    s1 = (f(s1, keyScheduleTable[i]) ^ s0) | 0;
    s0 = prev;
  }
  s0 = (f(s1, keyScheduleTable[15]) ^ s0) | 0;
  return inversePermutation(s0, s1);
}

function tripleDESDecrypt(block) {
  var ks0 = keySchedule(KEY, 16, false);
  var ks1 = keySchedule(KEY, 8, true);
  var ks2 = keySchedule(KEY, 0, false);
  var d = desCrypt(block, ks0);
  d = desCrypt(d, ks1);
  d = desCrypt(d, ks2);
  return d;
}

// ---- zlib inflate(标准 deflate,RFC1951) ------------------------------------

var LEN_BASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
var LEN_EXTRA = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
var DIST_BASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
var DIST_EXTRA = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];

function inflate(data) {
  var pos = 2; // 跳过 zlib header(0x78 0x9C 等)
  var bitBuf = 0, bitCnt = 0;
  function bits(n) {
    while (bitCnt < n) {
      bitBuf |= data[pos++] << bitCnt;
      bitCnt += 8;
    }
    var v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  }
  function buildTable(lengths, max) {
    // canonical Huffman 解码表
    var count = [];
    var offset = [];
    for (var i = 0; i <= max; i++) count.push(0);
    for (var j = 0; j < lengths.length; j++) if (lengths[j] > 0) count[lengths[j]]++;
    var code = 0;
    for (var l = 1; l <= max; l++) {
      offset.push(code);
      code = (code + count[l - 1]) << 1;
    }
    var symbols = [];
    for (var k = 0; k < lengths.length; k++) {
      if (lengths[k] > 0) symbols.push(k);
    }
    return { max: max, count: count, offset: offset, symbols: symbols, lens: lengths };
  }
  function decode(table) {
    var code = 0, first = 0, index = 0;
    for (var len = 1; len <= table.max; len++) {
      code = (code << 1) | bits(1);
      var cnt = table.count[len];
      if (cnt > 0 && code - first < cnt) {
        return table.symbols[table.offset[len] + (code - first)];
      }
      first = (first + cnt) << 1;
    }
    throw new Error("bad huffman code");
  }
  var out = [];
  var litTree, distTree;
  for (;;) {
    var bfinal = bits(1);
    var btype = bits(2);
    if (btype === 0) {
      // stored block
      bitCnt = 0; bitBuf = 0;
      var len = data[pos] | (data[pos + 1] << 8);
      pos += 4;
      for (var s = 0; s < len; s++) out.push(data[pos++]);
    } else if (btype === 1) {
      var fixedLit = [];
      for (var fl = 0; fl < 144; fl++) fixedLit.push(8);
      for (var fl2 = 144; fl2 < 256; fl2++) fixedLit.push(9);
      for (var fl3 = 256; fl3 < 280; fl3++) fixedLit.push(7);
      for (var fl4 = 280; fl4 < 288; fl4++) fixedLit.push(8);
      var fixedDist = [];
      for (var fd = 0; fd < 30; fd++) fixedDist.push(5);
      litTree = buildTable(fixedLit, 9);
      distTree = buildTable(fixedDist, 5);
    } else if (btype === 2) {
      var hlit = bits(5) + 257;
      var hdist = bits(5) + 1;
      var hclen = bits(4) + 4;
      var order = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
      var clen = [];
      for (var ci = 0; ci < 19; ci++) clen.push(0);
      for (var cj = 0; cj < hclen; cj++) clen[order[cj]] = bits(3);
      var codeLenTree = buildTable(clen, 7);
      var lens = [];
      while (lens.length < hlit + hdist) {
        var sym = decode(codeLenTree);
        if (sym < 16) {
          lens.push(sym);
        } else if (sym === 16) {
          var rep = 3 + bits(2);
          var prev = lens[lens.length - 1];
          for (var r = 0; r < rep; r++) lens.push(prev);
        } else if (sym === 17) {
          var rep0 = 3 + bits(3);
          for (var r2 = 0; r2 < rep0; r2++) lens.push(0);
        } else {
          var rep1 = 11 + bits(7);
          for (var r3 = 0; r3 < rep1; r3++) lens.push(0);
        }
      }
      litTree = buildTable(lens.slice(0, hlit), 15);
      distTree = buildTable(lens.slice(hlit), 15);
    } else {
      throw new Error("bad block type");
    }
    for (;;) {
      var lit = decode(litTree);
      if (lit < 256) {
        out.push(lit);
      } else if (lit === 256) {
        break;
      } else {
        var li = lit - 257;
        var length = LEN_BASE[li] + bits(LEN_EXTRA[li]);
        var di = decode(distTree);
        var dist = DIST_BASE[di] + bits(DIST_EXTRA[di]);
        for (var c = 0; c < length; c++) {
          out.push(out[out.length - dist]);
        }
      }
    }
    if (bfinal) break;
  }
  return out;
}

function utf8Decode(bytes) {
  var out = "";
  var i = 0;
  while (i < bytes.length) {
    var b = bytes[i++];
    if (b < 0x80) {
      out += String.fromCharCode(b);
    } else if (b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
    } else if (b < 0xf0) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    } else {
      var cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      out += String.fromCodePoint(cp);
    }
  }
  return out;
}

// ---- public ----------------------------------------------------------------

/** hex 字符串 → QRC 明文(失败返回 null)。 */
function qrcDecrypt(hexContent) {
  try {
    var hex = String(hexContent || "").trim();
    if (!hex) return null;
    if (hex.length % 2 !== 0) return null;
    var encrypted = [];
    for (var i = 0; i < hex.length; i += 2) {
      encrypted.push(parseInt(hex.substr(i, 2), 16));
    }
    if (encrypted.length % 8 !== 0) return null;
    var plain = [];
    for (var j = 0; j < encrypted.length; j += 8) {
      var block = encrypted.slice(j, j + 8);
      var dec = tripleDESDecrypt(block);
      for (var k = 0; k < 8; k++) plain.push(dec[k] & 0xff);
    }
    var inflated = inflate(plain);
    return utf8Decode(inflated);
  } catch (e) {
    return null;
  }
}

module.exports = { qrcDecrypt: qrcDecrypt };
