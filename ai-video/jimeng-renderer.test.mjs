import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createJimengRenderer,
  getJimengCredentials,
  mapAspectRatio,
  normalizeDuration,
} from "./jimeng-renderer.mjs";

test("getJimengCredentials rejects missing env vars", () => {
  assert.throws(() => getJimengCredentials({}), /VOLC_ACCESSKEY/);
});

test("mapAspectRatio and normalizeDuration use expected defaults", () => {
  assert.deepEqual(mapAspectRatio("9:16"), { width: 720, height: 1280 });
  assert.deepEqual(mapAspectRatio("16:9"), { width: 1280, height: 720 });
  assert.equal(normalizeDuration(11), 10);
  assert.equal(normalizeDuration(1), 2);
});

test("createJimengRenderer submits image and video tasks and downloads outputs", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jimeng-renderer-"));
  const imagePath = path.join(tempDir, "image.png");
  const clipPath = path.join(tempDir, "clip.mp4");
  const calls = [];
  const queryBodies = [];

  const renderer = createJimengRenderer({
    signRequest: async ({ action, body }) => {
      calls.push({ action, body });
      return {
        url: `https://example.com/${action}`,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      };
    },
    fetchImpl: async (url, options = {}) => {
      if (url === "https://example.com/CVSync2AsyncSubmitTask") {
        const body = JSON.parse(options.body);
        if (body.req_key === "jimeng_t2i_v31") {
          return new Response(JSON.stringify({ data: { task_id: "image-task" } }), { status: 200 });
        }

        return new Response(JSON.stringify({ data: { task_id: "video-task" } }), { status: 200 });
      }

      if (url === "https://example.com/CVSync2AsyncGetResult") {
        const body = JSON.parse(options.body);
        queryBodies.push(body);
        if (body.req_key === "jimeng_t2i_v31") {
          return new Response(
            JSON.stringify({ data: { status: "done", image_urls: ["https://assets.example.com/image.png"] } }),
            { status: 200 }
          );
        }

        return new Response(
          JSON.stringify({ data: { status: "done", video_url: "https://assets.example.com/clip.mp4" } }),
          { status: 200 }
        );
      }

      if (url === "https://assets.example.com/image.png") {
        return new Response(Buffer.from("png"), { status: 200 });
      }

      if (url === "https://assets.example.com/clip.mp4") {
        return new Response(Buffer.from("mp4"), { status: 200 });
      }

      throw new Error(`Unexpected URL ${url}`);
    },
    sleepImpl: async () => {},
  });

  const result = await renderer.renderShot({
    config: { aspectRatio: "9:16" },
    shot: { durationSeconds: 5 },
    imagePrompt: "image prompt",
    motionPrompt: "motion prompt",
    imagePath,
    clipPath,
  });

  assert.equal(calls[0].body.req_key, "jimeng_t2i_v31");
  assert.equal(calls[2].body.req_key, "jimeng_i2v_first_v30");
  assert.equal(queryBodies.length, 2);
  assert.equal(result.imageTaskId, "image-task");
  assert.equal(result.videoTaskId, "video-task");
  assert.equal(await fs.readFile(imagePath, "utf8"), "png");
  assert.equal(await fs.readFile(clipPath, "utf8"), "mp4");
});
