#!/usr/bin/env python3
import argparse
import hashlib
import json
import pathlib
import sys
import zipfile


def fail(message):
    raise SystemExit("invalid qplug: " + message)


parser = argparse.ArgumentParser(description="Verify a QPlayer .qplug archive")
parser.add_argument("archive", type=pathlib.Path)
args = parser.parse_args()

with zipfile.ZipFile(args.archive) as package:
    entries = [item.filename for item in package.infolist() if not item.is_dir()]
    if len(entries) != len(set(entries)):
        fail("duplicate archive path")
    for name in entries:
        path = pathlib.PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or "\\" in name:
            fail("unsafe archive path: " + name)

    hashes_path = "META-INF/qplayer-files.json"
    if hashes_path not in entries:
        fail("missing " + hashes_path)
    hashes = json.loads(package.read(hashes_path).decode("utf-8"))
    expected = set(entries) - {hashes_path, "META-INF/qplayer.sig"}
    if set(hashes) != expected:
        fail("hash manifest does not cover exactly the package files")
    for name, expected_hash in hashes.items():
        actual = hashlib.sha256(package.read(name)).hexdigest()
        if actual != str(expected_hash).lower():
            fail("digest mismatch: " + name)

    if "plugin.json" not in hashes:
        fail("plugin.json is not covered")
    manifest = json.loads(package.read("plugin.json").decode("utf-8"))
    entry = manifest.get("entry", "")
    if entry not in hashes:
        fail("entry module is not covered: " + entry)

print("verified {} ({} files, id={}, version={})".format(
    args.archive, len(hashes), manifest.get("id", ""), manifest.get("version", "")))
