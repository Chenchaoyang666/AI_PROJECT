import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertFfmpegAvailable,
  concatClips,
  normalizeClip,
} from "./ffmpeg-assembler.mjs";

test("assertFfmpegAvailable checks ffmpeg and ffprobe", async () => {
  const calls = [];
  const runCommand = async (command, args) => {
    calls.push([command, args]);
  };

  await assertFfmpegAvailable({ runCommand });

  assert.deepEqual(calls.map(([command]) => command), ["ffmpeg", "ffprobe"]);
});

test("normalizeClip builds the expected ffmpeg command", async () => {
  const calls = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ffmpeg-normalize-"));
  const outputPath = path.join(tempDir, "normalized.mp4");

  await normalizeClip({
    inputPath: "/tmp/input.mp4",
    outputPath,
    runCommand: async (command, args) => {
      calls.push([command, args]);
    },
  });

  assert.equal(calls[0][0], "ffmpeg");
  assert.match(calls[0][1].join(" "), /scale=1080:1920/);
  assert.match(calls[0][1].join(" "), /fps=24/);
});

test("concatClips writes concat file and invokes ffmpeg", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ffmpeg-concat-"));
  const concatFilePath = path.join(tempDir, "concat-list.txt");
  const outputPath = path.join(tempDir, "final.mp4");
  const calls = [];

  await concatClips({
    normalizedClipPaths: ["/tmp/a.mp4", "/tmp/b.mp4"],
    concatFilePath,
    outputPath,
    runCommand: async (command, args) => {
      calls.push([command, args]);
    },
  });

  const concatContents = await fs.readFile(concatFilePath, "utf8");
  assert.match(concatContents, /file '\/tmp\/a.mp4'/);
  assert.equal(calls[0][0], "ffmpeg");
  assert.match(calls[0][1].join(" "), /-f concat/);
});
