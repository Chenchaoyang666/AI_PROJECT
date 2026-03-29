import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runAiVideoPipeline } from "./pipeline.mjs";

function buildLogger() {
  return {
    lines: [],
    log(message) {
      this.lines.push(message);
    },
  };
}

test("pipeline fails before rendering if Volcengine credentials are missing", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-video-preflight-"));
  const storyFile = path.join(tempDir, "story.txt");
  await fs.writeFile(storyFile, "雨夜里，一个女孩站在城市街头，最后转身离开。\n", "utf8");

  let renderCalls = 0;

  await assert.rejects(
    runAiVideoPipeline(
      {
        storyFile,
        output: path.join(tempDir, "output"),
      },
      {
        env: {},
        renderer: {
          async renderShot() {
            renderCalls += 1;
          },
        },
        assembler: {
          async assertAvailable() {},
          async normalizeClip() {},
          async concatClips() {},
        },
        logger: buildLogger(),
      }
    ),
    /VOLC_ACCESSKEY/
  );

  assert.equal(renderCalls, 0);
});

test("pipeline fails before rendering if ffmpeg preflight fails", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-video-ffmpeg-preflight-"));
  const storyFile = path.join(tempDir, "story.txt");
  await fs.writeFile(storyFile, "雨夜里，一个女孩站在城市街头，最后转身离开。\n", "utf8");

  let renderCalls = 0;

  await assert.rejects(
    runAiVideoPipeline(
      {
        storyFile,
        output: path.join(tempDir, "output"),
      },
      {
        env: { VOLC_ACCESSKEY: "ak", VOLC_SECRETKEY: "sk" },
        renderer: {
          async renderShot() {
            renderCalls += 1;
          },
        },
        assembler: {
          async assertAvailable() {
            throw new Error("Missing ffmpeg");
          },
          async normalizeClip() {},
          async concatClips() {},
        },
        logger: buildLogger(),
      }
    ),
    /Missing ffmpeg/
  );

  assert.equal(renderCalls, 0);
});

test("pipeline reuses existing rendered assets when config hash matches", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-video-reuse-"));
  const outputDir = path.join(tempDir, "output");
  const storyFile = path.join(tempDir, "story.txt");
  await fs.writeFile(storyFile, "雨夜里，一个女孩站在城市街头，最后转身离开。\n", "utf8");

  const renderer = {
    calls: 0,
    async renderShot({ imagePath, clipPath }) {
      this.calls += 1;
      await fs.mkdir(path.dirname(imagePath), { recursive: true });
      await fs.mkdir(path.dirname(clipPath), { recursive: true });
      await fs.writeFile(imagePath, "image");
      await fs.writeFile(clipPath, "clip");
      return {
        imageTaskId: `image-${this.calls}`,
        videoTaskId: `video-${this.calls}`,
        imageUrl: "https://example.com/image.png",
        clipUrl: "https://example.com/clip.mp4",
      };
    },
  };

  const assembler = {
    normalized: 0,
    concatenated: 0,
    async assertAvailable() {},
    async normalizeClip({ outputPath }) {
      this.normalized += 1;
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, "normalized");
    },
    async concatClips({ outputPath }) {
      this.concatenated += 1;
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, "final");
    },
  };

  await runAiVideoPipeline(
    {
      storyFile,
      output: outputDir,
    },
      {
        env: { VOLC_ACCESSKEY: "ak", VOLC_SECRETKEY: "sk" },
        renderer,
      assembler,
      logger: buildLogger(),
    }
  );

  assert.equal(renderer.calls, 3);
  assert.equal(assembler.normalized, 3);
  assert.equal(assembler.concatenated, 1);

  renderer.calls = 0;
  assembler.normalized = 0;
  assembler.concatenated = 0;

  await runAiVideoPipeline(
    {
      storyFile,
      output: outputDir,
    },
      {
        env: { VOLC_ACCESSKEY: "ak", VOLC_SECRETKEY: "sk" },
        renderer,
      assembler,
      logger: buildLogger(),
    }
  );

  assert.equal(renderer.calls, 0);
  assert.equal(assembler.normalized, 0);
  assert.equal(assembler.concatenated, 0);
});

test("pipeline writes manifest and final video path", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-video-manifest-"));
  const outputDir = path.join(tempDir, "output");
  const storyFile = path.join(tempDir, "story.txt");
  await fs.writeFile(storyFile, "未来世界里，一个男人在安静的走廊中走向发光的尽头。\n", "utf8");

  const result = await runAiVideoPipeline(
    {
      storyFile,
      output: outputDir,
    },
      {
        env: { VOLC_ACCESSKEY: "ak", VOLC_SECRETKEY: "sk" },
        renderer: {
        async renderShot({ imagePath, clipPath }) {
          await fs.mkdir(path.dirname(imagePath), { recursive: true });
          await fs.mkdir(path.dirname(clipPath), { recursive: true });
          await fs.writeFile(imagePath, "image");
          await fs.writeFile(clipPath, "clip");
          return {
            imageTaskId: "image-task",
            videoTaskId: "video-task",
            imageUrl: "https://example.com/image.png",
            clipUrl: "https://example.com/clip.mp4",
          };
        },
      },
      assembler: {
        async assertAvailable() {},
        async normalizeClip({ outputPath }) {
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
          await fs.writeFile(outputPath, "normalized");
        },
        async concatClips({ outputPath }) {
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
          await fs.writeFile(outputPath, "final");
        },
      },
      logger: buildLogger(),
    }
  );

  const manifestRaw = await fs.readFile(result.manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw);

  assert.equal(manifest.final.status, "complete");
  assert.equal(manifest.final.outputPath, result.finalVideoPath);
  assert.match(result.finalVideoPath, /final\/.+\.mp4$/);
});
