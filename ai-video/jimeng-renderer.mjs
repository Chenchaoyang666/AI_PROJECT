import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_ENDPOINT = "https://visual.volcengineapi.com";
const DEFAULT_SERVICE = "cv";
const DEFAULT_REGION = "cn-north-1";
const DEFAULT_API_VERSION = "2022-08-31";
const DEFAULT_SUBMIT_ACTION = "CVSync2AsyncSubmitTask";
const DEFAULT_GET_ACTION = "CVSync2AsyncGetResult";
const DEFAULT_T2I_REQ_KEY = "jimeng_t2i_v31";
const DEFAULT_I2V_REQ_KEY = "jimeng_i2v_first_v30";
const DEFAULT_POLL_INTERVAL_MS = 4000;
const DEFAULT_MAX_POLLS = 90;

function pickCredential(env, primary, fallback) {
  return (env[primary] || env[fallback] || "").trim();
}

export function getJimengCredentials(env = process.env) {
  const accessKeyId = pickCredential(env, "VOLC_ACCESSKEY", "JIMENG_ACCESS_KEY");
  const secretKey = pickCredential(env, "VOLC_SECRETKEY", "JIMENG_SECRET_KEY");
  const sessionToken = pickCredential(env, "VOLC_SESSION_TOKEN", "JIMENG_SESSION_TOKEN");

  if (!accessKeyId || !secretKey) {
    throw new Error(
      "Missing Volcengine credentials. Set VOLC_ACCESSKEY and VOLC_SECRETKEY before running the AI video pipeline."
    );
  }

  return { accessKeyId, secretKey, sessionToken };
}

export function mapAspectRatio(aspectRatio) {
  if (aspectRatio === "16:9") return { width: 1280, height: 720 };
  if (aspectRatio === "1:1") return { width: 1024, height: 1024 };
  return { width: 720, height: 1280 };
}

export function normalizeDuration(durationSeconds) {
  const rounded = Math.round(Number(durationSeconds) || 5);
  return Math.max(2, Math.min(10, rounded));
}

export async function downloadFile(url, destinationPath, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required to download Jimeng outputs.");
  }

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.writeFile(destinationPath, Buffer.from(arrayBuffer));
}

export async function fileToBase64(filePath) {
  const buffer = await fs.readFile(filePath);
  return buffer.toString("base64");
}

async function loadOpenApiModule(moduleLoader) {
  try {
    return await (moduleLoader ? moduleLoader() : import("@volcengine/openapi"));
  } catch (error) {
    if (String(error?.message || "").includes("@volcengine/openapi")) {
      throw new Error('Missing dependency "@volcengine/openapi". Run "npm install" before using Jimeng automation.');
    }

    throw error;
  }
}

export async function createVolcRequestSigner({
  env = process.env,
  moduleLoader,
  endpoint = DEFAULT_ENDPOINT,
  region = DEFAULT_REGION,
  service = DEFAULT_SERVICE,
} = {}) {
  const credentials = getJimengCredentials(env);
  const openapiModule = await loadOpenApiModule(moduleLoader);
  const Signer = openapiModule.Signer ?? openapiModule.default?.Signer ?? openapiModule.default;

  if (typeof Signer !== "function") {
    throw new Error("Unable to initialize the Volcengine OpenAPI signer.");
  }

  const host = new URL(endpoint).host;

  return async function signRequest({ action, version = DEFAULT_API_VERSION, body }) {
    const request = {
      method: "POST",
      region,
      params: {
        Action: action,
        Version: version,
      },
      headers: {
        "Content-Type": "application/json",
        Host: host,
      },
      body: JSON.stringify(body),
    };

    const signer = new Signer(request, service);
    signer.addAuthorization(credentials);

    return {
      url: `${endpoint}/?${new URLSearchParams(request.params).toString()}`,
      method: request.method,
      headers: request.headers,
      body: request.body,
    };
  };
}

function unwrapVolcResponse(json) {
  if (json?.ResponseMetadata?.Error) {
    const error = json.ResponseMetadata.Error;
    throw new Error(error.Message || error.Code || "Volcengine API request failed.");
  }

  if (json?.code && json.code !== 10000 && json.code !== 0) {
    throw new Error(json.message || `Volcengine API request failed with code ${json.code}.`);
  }

  return json?.Result || json?.data || json;
}

function extractTaskId(payload, label) {
  const taskId =
    payload?.task_id ||
    payload?.taskId ||
    payload?.id ||
    payload?.submit_id ||
    payload?.submitId ||
    payload?.transaction_no ||
    payload?.transactionNo;

  if (!taskId) {
    throw new Error(`Jimeng ${label} did not return a task id.`);
  }

  return taskId;
}

function isTerminalStatus(statusValue) {
  const normalized = String(statusValue || "").toLowerCase();
  return ["done", "success", "succeeded", "finished", "completed"].includes(normalized);
}

function isFailureStatus(statusValue) {
  const normalized = String(statusValue || "").toLowerCase();
  return ["failed", "error", "timeout", "canceled", "cancelled"].includes(normalized);
}

function extractUrls(payload) {
  const candidates = [
    payload?.image_urls,
    payload?.images,
    payload?.data?.image_urls,
    payload?.data?.images,
    payload?.video_urls,
    payload?.videos,
    payload?.data?.video_urls,
    payload?.data?.videos,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate.map((item) => (typeof item === "string" ? item : item?.url || item?.uri)).filter(Boolean);
    }
  }

  const singleCandidates = [
    payload?.image_url,
    payload?.video_url,
    payload?.data?.image_url,
    payload?.data?.video_url,
    payload?.url,
    payload?.uri,
  ].filter(Boolean);

  if (singleCandidates.length > 0) {
    return singleCandidates;
  }

  return [];
}

async function submitTask({
  signRequest,
  fetchImpl,
  action = DEFAULT_SUBMIT_ACTION,
  body,
}) {
  const request = await signRequest({ action, body });
  const response = await fetchImpl(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });

  if (!response.ok) {
    throw new Error(`Volcengine submit request failed: ${response.status} ${response.statusText}`);
  }

  return unwrapVolcResponse(await response.json());
}

async function queryTask({
  signRequest,
  fetchImpl,
  body,
  action = DEFAULT_GET_ACTION,
}) {
  const request = await signRequest({ action, body });
  const response = await fetchImpl(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });

  if (!response.ok) {
    throw new Error(`Volcengine task query failed: ${response.status} ${response.statusText}`);
  }

  return unwrapVolcResponse(await response.json());
}

async function waitForTaskResult({
  signRequest,
  fetchImpl,
  reqKey,
  taskId,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  maxPolls = DEFAULT_MAX_POLLS,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const payload = await queryTask({
      signRequest,
      fetchImpl,
      body: {
        req_key: reqKey,
        task_id: taskId,
        transaction_no: taskId,
      },
    });

    const status =
      payload?.status ||
      payload?.task_status ||
      payload?.state ||
      payload?.data?.status ||
      payload?.data?.task_status;

    const urls = extractUrls(payload);
    if (urls.length > 0 || isTerminalStatus(status)) {
      return {
        taskId,
        status: status || "done",
        urls,
        payload,
      };
    }

    if (isFailureStatus(status)) {
      throw new Error(payload?.message || payload?.error || `Jimeng task ${taskId} failed.`);
    }

    await sleepImpl(pollIntervalMs);
  }

  throw new Error(`Jimeng task ${taskId} timed out after ${maxPolls} polls.`);
}

function buildTextToImageBody({ imagePrompt, config, reqKey, imageOptions = {} }) {
  const { width, height } = mapAspectRatio(config.aspectRatio);
  return {
    req_key: reqKey,
    prompt: imagePrompt,
    width,
    height,
    return_url: true,
    seed: imageOptions.seed ?? 0,
    req_json: JSON.stringify({
      return_url: true,
      logo_info: {
        add_logo: false,
      },
    }),
  };
}

function buildImageToVideoBody({ motionPrompt, shot, imageBase64, config, reqKey, videoOptions = {} }) {
  const { width, height } = mapAspectRatio(config.aspectRatio);
  return {
    req_key: reqKey,
    prompt: motionPrompt,
    width,
    height,
    duration: normalizeDuration(shot.durationSeconds),
    return_url: true,
    binary_data_base64: [imageBase64],
    seed: videoOptions.seed ?? 0,
    req_json: JSON.stringify({
      return_url: true,
      logo_info: {
        add_logo: false,
      },
    }),
  };
}

export function createJimengRenderer({
  env = process.env,
  signRequest,
  moduleLoader,
  fetchImpl = globalThis.fetch,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  maxPolls = DEFAULT_MAX_POLLS,
  sleepImpl,
  endpoint = DEFAULT_ENDPOINT,
  submitAction = DEFAULT_SUBMIT_ACTION,
  textToImageReqKey = DEFAULT_T2I_REQ_KEY,
  imageToVideoReqKey = DEFAULT_I2V_REQ_KEY,
} = {}) {
  return {
    async renderShot({ config, shot, imagePrompt, motionPrompt, imagePath, clipPath }) {
      const signer =
        signRequest ??
        (await createVolcRequestSigner({
          env,
          moduleLoader,
          endpoint,
        }));

      if (typeof fetchImpl !== "function") {
        throw new Error("A fetch implementation is required to call Jimeng APIs.");
      }

      const imageSubmitPayload = await submitTask({
        signRequest: signer,
        fetchImpl,
        action: submitAction,
        body: buildTextToImageBody({ imagePrompt, config, reqKey: textToImageReqKey }),
      });
      const imageTaskId = extractTaskId(imageSubmitPayload, "text-to-image");
      const imageResult = await waitForTaskResult({
        signRequest: signer,
        fetchImpl,
        reqKey: textToImageReqKey,
        taskId: imageTaskId,
        pollIntervalMs,
        maxPolls,
        sleepImpl,
      });

      const imageUrl = imageResult.urls[0];
      if (!imageUrl) {
        throw new Error(`Jimeng text-to-image task ${imageTaskId} completed without an image URL.`);
      }

      await downloadFile(imageUrl, imagePath, fetchImpl);
      const imageBase64 = await fileToBase64(imagePath);

      const videoSubmitPayload = await submitTask({
        signRequest: signer,
        fetchImpl,
        action: submitAction,
        body: buildImageToVideoBody({
          motionPrompt,
          shot,
          imageBase64,
          config,
          reqKey: imageToVideoReqKey,
        }),
      });
      const videoTaskId = extractTaskId(videoSubmitPayload, "image-to-video");
      const videoResult = await waitForTaskResult({
        signRequest: signer,
        fetchImpl,
        reqKey: imageToVideoReqKey,
        taskId: videoTaskId,
        pollIntervalMs,
        maxPolls,
        sleepImpl,
      });

      const clipUrl = videoResult.urls[0];
      if (!clipUrl) {
        throw new Error(`Jimeng image-to-video task ${videoTaskId} completed without a video URL.`);
      }

      await downloadFile(clipUrl, clipPath, fetchImpl);

      return {
        imageTaskId,
        videoTaskId,
        imageUrl,
        clipUrl,
        imagePath,
        clipPath,
      };
    },
  };
}
