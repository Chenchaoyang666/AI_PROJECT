import fs from "node:fs/promises";
import path from "node:path";

import {
  buildImagePrompt,
  buildMotionPrompt,
  computeConfigHash,
  printHelp,
  parseArgs,
  writeBeginnerStarter,
} from "./create-beginner-starter.mjs";
import { createJimengRenderer, getJimengCredentials } from "./jimeng-renderer.mjs";
import { createFfmpegAssembler } from "./ffmpeg-assembler.mjs";

function nowIso() {
  return new Date().toISOString();
}

function createProjectPaths(outputDir, projectSlug) {
  const assetsDir = path.join(outputDir, "assets");
  return {
    outputDir,
    imagesDir: path.join(assetsDir, "images"),
    clipsDir: path.join(assetsDir, "clips"),
    normalizedClipsDir: path.join(assetsDir, "clips-normalized"),
    finalDir: path.join(outputDir, "final"),
    finalVideoPath: path.join(outputDir, "final", `${projectSlug}.mp4`),
    manifestPath: path.join(outputDir, "render-manifest.json"),
    concatFilePath: path.join(outputDir, "assets", "concat-list.txt"),
  };
}

async function ensureProjectDirs(paths) {
  await Promise.all([
    fs.mkdir(paths.imagesDir, { recursive: true }),
    fs.mkdir(paths.clipsDir, { recursive: true }),
    fs.mkdir(paths.normalizedClipsDir, { recursive: true }),
    fs.mkdir(paths.finalDir, { recursive: true }),
  ]);
}

async function loadManifest(manifestPath) {
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}

function buildBaseManifest({ starterResult, paths }) {
  return {
    version: 1,
    configHash: starterResult.configHash,
    title: starterResult.config.title,
    story: starterResult.story,
    sourceFile: starterResult.sourceFile,
    outputDir: starterResult.outputDir,
    finalVideoPath: paths.finalVideoPath,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    shots: {},
  };
}

async function saveManifest(manifest, manifestPath) {
  manifest.updatedAt = nowIso();
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function ensureManifestShot(manifest, shot, imagePrompt, motionPrompt, paths) {
  const existing = manifest.shots[shot.id] ?? {};
  manifest.shots[shot.id] = {
    id: shot.id,
    imagePrompt,
    motionPrompt,
    imagePath: path.join(paths.imagesDir, `${shot.id}.png`),
    clipPath: path.join(paths.clipsDir, `${shot.id}.mp4`),
    normalizedClipPath: path.join(paths.normalizedClipsDir, `${shot.id}.mp4`),
    status: existing.status ?? "pending",
    imageTaskId: existing.imageTaskId ?? null,
    videoTaskId: existing.videoTaskId ?? null,
    imageUrl: existing.imageUrl ?? null,
    clipUrl: existing.clipUrl ?? null,
    error: existing.error ?? null,
  };

  return manifest.shots[shot.id];
}

async function renderAllShots({ starterResult, manifest, paths, renderer }) {
  for (const shot of starterResult.config.shots) {
    const imagePrompt = buildImagePrompt(starterResult.config, shot);
    const motionPrompt = buildMotionPrompt(shot);
    const shotEntry = ensureManifestShot(manifest, shot, imagePrompt, motionPrompt, paths);

    if (
      manifest.configHash === starterResult.configHash &&
      ["rendered", "normalized"].includes(shotEntry.status) &&
      (await fileExists(shotEntry.imagePath)) &&
      (await fileExists(shotEntry.clipPath))
    ) {
      continue;
    }

    try {
      const renderResult = await renderer.renderShot({
        config: starterResult.config,
        shot,
        imagePrompt,
        motionPrompt,
        imagePath: shotEntry.imagePath,
        clipPath: shotEntry.clipPath,
      });

      Object.assign(shotEntry, {
        status: "rendered",
        error: null,
        imageTaskId: renderResult.imageTaskId,
        videoTaskId: renderResult.videoTaskId,
        imageUrl: renderResult.imageUrl,
        clipUrl: renderResult.clipUrl,
      });
    } catch (error) {
      shotEntry.status = "failed";
      shotEntry.error = error.message;
      throw error;
    } finally {
      await saveManifest(manifest, paths.manifestPath);
    }
  }
}

async function normalizeAllShots({ shots, manifest, assembler, paths, configHash }) {
  for (const shot of shots) {
    const shotEntry = manifest.shots[shot.id];
    if (!shotEntry) {
      throw new Error(`Missing manifest entry for shot ${shot.id}.`);
    }

    if (
      manifest.configHash === configHash &&
      shotEntry.status === "normalized" &&
      (await fileExists(shotEntry.normalizedClipPath))
    ) {
      continue;
    }

    try {
      await assembler.normalizeClip({
        inputPath: shotEntry.clipPath,
        outputPath: shotEntry.normalizedClipPath,
      });
      shotEntry.status = "normalized";
      shotEntry.error = null;
    } catch (error) {
      shotEntry.status = "failed";
      shotEntry.error = error.message;
      throw error;
    } finally {
      await saveManifest(manifest, paths.manifestPath);
    }
  }
}

async function concatFinalVideo({ shots, manifest, assembler, paths, starterResult }) {
  const normalizedClipPaths = shots.map((shot) => manifest.shots[shot.id]?.normalizedClipPath);
  const shouldReuseFinal =
    manifest.configHash === starterResult.configHash &&
    manifest.final?.status === "complete" &&
    (await fileExists(paths.finalVideoPath)) &&
    (await Promise.all(normalizedClipPaths.map(fileExists))).every(Boolean);

  if (shouldReuseFinal) return;

  await assembler.concatClips({
    normalizedClipPaths,
    concatFilePath: paths.concatFilePath,
    outputPath: paths.finalVideoPath,
  });

  manifest.final = {
    status: "complete",
    outputPath: paths.finalVideoPath,
  };
  await saveManifest(manifest, paths.manifestPath);
}

export async function runAiVideoPipeline(
  argsOrOptions = process.argv.slice(2),
  {
    env = process.env,
    renderer = createJimengRenderer({ env }),
    assembler = createFfmpegAssembler(),
    logger = console,
  } = {}
) {
  const options = Array.isArray(argsOrOptions) ? parseArgs(argsOrOptions) : argsOrOptions;

  if (options.help) {
    printHelp();
    return null;
  }

  const starterResult = await writeBeginnerStarter(options);
  const configHash = computeConfigHash(starterResult.config);
  starterResult.configHash = configHash;

  getJimengCredentials(env);
  await assembler.assertAvailable();

  const paths = createProjectPaths(starterResult.outputDir, starterResult.projectSlug);
  await ensureProjectDirs(paths);

  const existingManifest = await loadManifest(paths.manifestPath);
  const manifest =
    existingManifest && existingManifest.configHash === starterResult.configHash
      ? existingManifest
      : buildBaseManifest({ starterResult, paths });
  manifest.configHash = starterResult.configHash;

  await saveManifest(manifest, paths.manifestPath);
  await renderAllShots({ starterResult, manifest, paths, renderer });
  await normalizeAllShots({
    shots: starterResult.config.shots,
    manifest,
    assembler,
    paths,
    configHash: starterResult.configHash,
  });
  await concatFinalVideo({ shots: starterResult.config.shots, manifest, assembler, paths, starterResult });

  logger.log(`Generated beginner starter with preset "${starterResult.preset}" in ${starterResult.outputDir}`);
  if (starterResult.sourceFile) {
    logger.log(`Story source: ${starterResult.sourceFile}`);
  }
  logger.log(`Final video: ${paths.finalVideoPath}`);

  return {
    ...starterResult,
    manifestPath: paths.manifestPath,
    finalVideoPath: paths.finalVideoPath,
  };
}
