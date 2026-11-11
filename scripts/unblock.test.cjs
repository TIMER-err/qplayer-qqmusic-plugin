"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {test} = require("node:test");

function load(call = () => Promise.reject(new Error("Unexpected host call"))) {
  const context = vm.createContext({module: {exports: {}}, qplayer: {call}});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/unblock.js"), "utf8"), context);
  return context;
}

// Actual Kuwo search order for 忘川彼岸-零一九零贰. The DJ recording is only
// three seconds longer, so a duration tolerance alone cannot reject it.
const candidates = [
  {SONGNAME: "忘川彼岸 (DJ名龙版)", ARTIST: "零一九零贰", DURATION: "180", MUSICRID: "MUSIC_146194273"},
  {SONGNAME: "忘川彼岸", ARTIST: "零一九零贰", DURATION: "177", MUSICRID: "MUSIC_145215536"}
];

function pick(context, list, name = "忘川彼岸", duration = 177000) {
  return context.pickMatch(list, x => x.SONGNAME, x => x.ARTIST, x => x.DURATION,
      name, "零一九零贰", duration);
}

test("real search order selects original rather than first DJ result", () => {
  assert.equal(pick(load(), candidates).MUSICRID, "MUSIC_145215536");
});

test("春庭雪 real candidates reject translated remix and slowed DJ versions", () => {
  const context = load();
  const list = [
    {SONGNAME: "Xuân Đình Tuyết / 春庭雪 (Hiên Kun Remix)",
      ARTIST: "Hiên Kun's&等什麼君&Đẳng Thập Yêu Quân&等什么君&Hiên Kun", DURATION: "226", MUSICRID: "MUSIC_476765578"},
    {SONGNAME: "春庭雪 (0.9x版DJ Wave版)", ARTIST: "邓寓君(等什么君)", DURATION: "422", MUSICRID: "MUSIC_387471571"},
    {SONGNAME: "春庭雪", ARTIST: "邓寓君(等什么君)", DURATION: "240", MUSICRID: "MUSIC_144914539"}
  ];
  const select = rows => context.pickMatch(rows, x => x.SONGNAME, x => x.ARTIST,
      x => x.DURATION, "春庭雪", "等什么君", 240000);
  assert.equal(select(list).MUSICRID, "MUSIC_144914539");
  assert.equal(select(list.slice(0, 2)), null);
});

test("never substitute a derivative when original is absent", () => {
  const context = load();
  for (const suffix of ["DJ名龙版", "DJ哭包版", "宿命版", "治愈版", "KTV版伴奏", "Live", "Remix"]) {
    assert.equal(pick(context, [{...candidates[1], SONGNAME: `忘川彼岸 (${suffix})`}]), null, suffix);
  }
});

test("distinct derivative versions must not match each other", () => {
  const context = load();
  assert.equal(pick(context, candidates, "忘川彼岸 (DJ哭包版)", 180000), null);
  assert.equal(pick(context, candidates, "忘川彼岸（DJ名龙版）", 180000).MUSICRID, "MUSIC_146194273");
  assert.equal(pick(context, [{...candidates[1], SONGNAME: "忘川彼岸 (Live)"}], "忘川彼岸 (Remix)"), null);
});

test("dash suffixes carry version identity too", () => {
  const context = load();
  assert.equal(pick(context, [{...candidates[1], SONGNAME: "忘川彼岸 - DJ名龙版"}]), null);
  assert.equal(pick(context, candidates, "忘川彼岸 - DJ名龙版", 180000).MUSICRID, "MUSIC_146194273");
});

test("release labels are harmless but different songs, singers and durations are not", () => {
  const context = load();
  assert.ok(pick(context, [{...candidates[1], SONGNAME: "忘川彼岸 (Remastered)"}]));
  assert.equal(pick(context, [{...candidates[1], SONGNAME: "忘川彼岸续集"}]), null);
  assert.equal(pick(context, [{...candidates[1], ARTIST: "其他歌手"}]), null);
  assert.equal(pick(context, [{...candidates[1], DURATION: "200"}]), null);
});

test("resolve uses original RID throughout the fallback request chain", async () => {
  const urls = [];
  const context = load(async (method, args) => {
    if (method === "storage.get") return true;
    if (method === "notifications.toast") return true;
    if (method === "crypto.digest") return "test-signature";
    assert.equal(method, "http.request");
    urls.push(args.url);
    if (args.url.includes("search.kuwo.cn")) {
      return {status: 200, body: JSON.stringify({content: [{}, {musicpage: {abslist: candidates}}]})};
    }
    if (args.url.includes("/advert/watch")) return {status: 200, body: "{}"};
    if (args.url.includes("/audioUrl?")) {
      assert.match(args.url, /musicId=145215536(?:&|$)/);
      return {status: 200, body: JSON.stringify({data: {audioUrl: "https://audio.example/original.mp3"}})};
    }
    throw new Error(`Unexpected URL: ${args.url}`);
  });
  const stream = await context.module.exports.resolve({songDetails: async () => [{
    title: "忘川彼岸", artists: [{name: "零一九零贰"}], durationMs: 177000
  }]});
  assert.equal(stream.url, "https://audio.example/original.mp3");
  assert.equal(stream.cacheable, true);
  assert.equal(urls.some(url => url.includes("146194273")), false);
});
