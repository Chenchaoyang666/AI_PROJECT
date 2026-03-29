import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function createCommandRunner(execFileImpl = execFileAsync) {
  return async (command, args) => execFileImpl(command, args);
}

export function escapeConcatPath(filePath) {
  return filePath.replaceAll("'", "'\\''");
}

export async function assertFfmpegAvailable({ runCommand = createCommandRunner() } = {}) {
  try {
    await runCommand("ffmpeg", ["-version"]);
  } catch (error) {
    throw new Error("Missing ffmpeg. Install ffmpeg before generating the final AI video.");
  }

  try {
    await runCommand("ffprobe", ["-version"]);
  } catch (error) {
    throw new Error("Missing ffprobe. Install ffmpeg/ffprobe before generating the final AI video.");
  }
}

export async function normalizeClip({
  inputPath,
  outputPath,
  runCommand = createCommandRunner(),
} = {}) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await runCommand("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-vf",
    "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,fps=24",
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

export async function concatClips({
  normalizedClipPaths,
  concatFilePath,
  outputPath,
  runCommand = createCommandRunner(),
} = {}) {
  await fs.mkdir(path.dirname(concatFilePath), { recursive: true });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const concatContents = normalizedClipPaths
    .map((clipPath) => `file '${escapeConcatPath(clipPath)}'`)
    .join("\n");

  await fs.writeFile(concatFilePath, `${concatContents}\n`, "utf8");

  await runCommand("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatFilePath,
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

export function createFfmpegAssembler(options = {}) {
  return {
    assertAvailable: () => assertFfmpegAvailable(options),
    normalizeClip: (params) => normalizeClip({ ...params, ...options }),
    concatClips: (params) => concatClips({ ...params, ...options }),
  };
}
