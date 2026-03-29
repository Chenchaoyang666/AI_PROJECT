import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildBeginnerConfig, writeBeginnerStarter } from "./create-beginner-starter.mjs";

test("buildBeginnerConfig auto-picks neon preset for rainy city story", () => {
  const config = buildBeginnerConfig({
    story: "雨夜里，一个女孩站在城市街头，最后转身离开。",
  });

  assert.match(config.title, /^雨夜里 一个女孩站在城/);
  assert.match(config.visualStyle, /moody blue-red lighting/);
  assert.equal(config.shots[2].camera, "short follow shot from behind");
  assert.match(config.shots[2].action, /walks away/);
});

test("buildBeginnerConfig respects explicit preset and character name", () => {
  const config = buildBeginnerConfig({
    story: "一个人站在夕阳里，像在回忆过去。",
    preset: "sunset-memory",
    name: "Ming",
    title: "回忆的风",
  });

  assert.equal(config.title, "回忆的风");
  assert.equal(config.character.name, "Ming");
  assert.match(config.musicStyle, /piano/);
  assert.match(config.shots[0].scene, /sunset/);
});

test("writeBeginnerStarter writes config and starter files", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-video-beginner-"));
  const outputDir = path.join(tempDir, "project");

  const result = await writeBeginnerStarter({
    story: "未来世界里，一个男人在安静的走廊中走向发光的尽头。",
    output: outputDir,
  });

  assert.equal(result.fileCount, 6);
  const configRaw = await fs.readFile(path.join(outputDir, "00-story-config.json"), "utf8");
  const promptRaw = await fs.readFile(path.join(outputDir, "02-video-prompts.md"), "utf8");

  assert.match(configRaw, /"title":/);
  assert.match(promptRaw, /### Key Image Prompt/);
});

test("writeBeginnerStarter accepts a story text file", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-video-beginner-file-"));
  const outputDir = path.join(tempDir, "project");
  const storyFile = path.join(tempDir, "story.txt");

  await fs.writeFile(storyFile, "黄昏里，一个人站在海边，像在回忆过去。\n", "utf8");

  await writeBeginnerStarter({
    storyFile,
    output: outputDir,
    preset: "sunset-memory",
  });

  const savedStory = await fs.readFile(path.join(outputDir, "00-story.txt"), "utf8");
  const configRaw = await fs.readFile(path.join(outputDir, "00-story-config.json"), "utf8");

  assert.match(savedStory, /黄昏里，一个人站在海边，像在回忆过去。/);
  assert.match(configRaw, /sunset/);
});

test("writeBeginnerStarter auto-loads the latest story file and default output dir", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-video-beginner-latest-"));
  const storiesDir = path.join(tempDir, "stories");
  const oldStoryFile = path.join(storiesDir, "old-story.txt");
  const newStoryFile = path.join(storiesDir, "latest-story.txt");

  await fs.mkdir(storiesDir, { recursive: true });
  await fs.writeFile(oldStoryFile, "黄昏里，一个人停在海边。\n", "utf8");
  await new Promise((resolve) => setTimeout(resolve, 20));
  await fs.writeFile(newStoryFile, "未来世界里，一个人走向发光的长廊尽头。\n", "utf8");
  const outputDir = path.join(tempDir, "custom-output");

  const result = await writeBeginnerStarter({
    storiesDir,
    output: outputDir,
  });

  assert.equal(result.sourceFile, newStoryFile);
  assert.equal(result.outputDir, outputDir);

  const savedStory = await fs.readFile(path.join(outputDir, "00-story.txt"), "utf8");
  assert.match(savedStory, /未来世界里，一个人走向发光的长廊尽头。/);
});
