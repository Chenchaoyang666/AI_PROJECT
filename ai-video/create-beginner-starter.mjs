import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STORIES_DIR = path.join(SCRIPT_DIR, "stories");
const DEFAULT_OUTPUT_DIR = path.join(SCRIPT_DIR, "output");
const DEFAULTS = {
  aspectRatio: "9:16",
  targetDurationSeconds: 20,
  platform: "Douyin / Reels / Shorts",
  language: "zh-CN",
  musicStyle: "moody cinematic ambient",
  colorPalette: "blue-red neon, wet reflections, soft contrast",
  motionRule: "Each shot should keep one core action and restrained motion.",
  exportSpec: "1080x1920, H.264, keep a clean version before subtitles.",
};

const PRESETS = {
  "neon-rain": {
    key: "neon-rain",
    titleHint: "霓虹雨夜",
    keywords: ["雨", "夜", "霓虹", "城市", "街头", "rain", "night", "neon", "city", "street"],
    visualStyle: "cinematic realism, moody blue-red lighting, soft contrast",
    musicStyle: "slow atmospheric electronic with distant city ambience",
    colorPalette: "blue neon, red accents, silver reflections, wet asphalt glow",
    environmentNotes: "Keep the same rainy city street, same neon palette, and restrained background movement throughout.",
    motionRule: "Each shot should focus on one simple action with natural motion and no exaggerated gestures.",
    exportSpec: "1080x1920, H.264, clean master first, then subtitle version.",
    baseScene: "rainy neon street at night",
    openingSubject: "stands alone under a flickering sign",
    openingAction: "keeps still for a moment and breathes slowly",
    middleSubject: "in three-quarter profile under reflected neon light",
    middleAction: "slowly raises the head and looks into the distance",
    endingSubject: "from the side as light passes across the face",
    openingSubtitle: "雨停了，情绪还没有散。",
    middleSubtitle: "那一刻，像是有什么变了。",
    endingSubtitle: "这一次，终于往前走了。",
  },
  "sunset-memory": {
    key: "sunset-memory",
    titleHint: "黄昏回忆",
    keywords: ["黄昏", "夕阳", "夏天", "回忆", "校园", "海边", "sunset", "summer", "memory", "school", "beach"],
    visualStyle: "cinematic realism, warm sunset glow, gentle grain, nostalgic softness",
    musicStyle: "light piano with airy ambient texture",
    colorPalette: "amber sunset, dusty blue, pale gold highlights",
    environmentNotes: "Keep the same quiet outdoor location and soft backlight across all shots.",
    motionRule: "Keep motion gentle and readable, like memory fragments rather than dramatic acting.",
    exportSpec: "1080x1920, H.264, clean master first, then subtitle version.",
    baseScene: "quiet outdoor path at sunset with warm backlight",
    openingSubject: "pauses alone in the warm evening light",
    openingAction: "stands still and lets the breeze move the hair and clothes slightly",
    middleSubject: "in profile with light falling across the face",
    middleAction: "slowly looks toward the light as if remembering something",
    endingSubject: "from behind while stepping forward into the sunset",
    openingSubtitle: "黄昏总会把人带回从前。",
    middleSubtitle: "有些回忆，原来一直都在。",
    endingSubtitle: "但人还是要继续往前走。",
  },
  "quiet-sci-fi": {
    key: "quiet-sci-fi",
    titleHint: "静默科幻",
    keywords: ["未来", "科幻", "宇宙", "飞船", "机器人", "future", "sci-fi", "space", "robot", "station"],
    visualStyle: "cinematic sci-fi realism, controlled contrast, cool metallic light",
    musicStyle: "minimal synth drone with subtle pulses",
    colorPalette: "cool white, steel blue, faint cyan interface glow",
    environmentNotes: "Keep the same futuristic corridor or room, with minimal moving elements and controlled lighting.",
    motionRule: "Use calm, precise motion and avoid exaggerated action or combat beats.",
    exportSpec: "1080x1920, H.264, clean master first, then subtitle version.",
    baseScene: "quiet futuristic corridor with soft interface glow",
    openingSubject: "stands alone in a quiet corridor",
    openingAction: "keeps a calm stance while distant lights pulse softly",
    middleSubject: "in close three-quarter profile near a glowing panel",
    middleAction: "slowly turns the gaze toward the light source",
    endingSubject: "walking forward into a long illuminated passage",
    openingSubtitle: "安静，有时比噪音更有力量。",
    middleSubtitle: "答案好像就在眼前。",
    endingSubtitle: "接下来，只能自己走过去。",
  },
};

const FEMALE_HINTS = ["女孩", "女生", "女人", "她", "小姐"];
const MALE_HINTS = ["男孩", "男生", "男人", "他", "少年"];
const WALK_AWAY_HINTS = ["离开", "走", "走开", "转身", "远去", "forward", "leave", "walk"];
const LOOK_BACK_HINTS = ["回头", "回望", "look back", "over shoulder"];

export function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--story") {
      args.story = argv[i + 1];
      i += 1;
    } else if (token === "--story-file") {
      args.storyFile = argv[i + 1];
      i += 1;
    } else if (token === "--stories-dir") {
      args.storiesDir = argv[i + 1];
      i += 1;
    } else if (token === "--output") {
      args.output = argv[i + 1];
      i += 1;
    } else if (token === "--title") {
      args.title = argv[i + 1];
      i += 1;
    } else if (token === "--preset") {
      args.preset = argv[i + 1];
      i += 1;
    } else if (token === "--name") {
      args.name = argv[i + 1];
      i += 1;
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

export function printHelp() {
  console.log(`Beginner AI video starter generator

Usage:
  node ai-video/create-beginner-starter.mjs --story "<一句话故事>" --output <dir>
  node ai-video/create-beginner-starter.mjs --story-file <story.txt> --output <dir>
  node ai-video/create-beginner-starter.mjs
  node ai-video/create-beginner-starter.mjs --stories-dir ./my-stories

Options:
  --story    One-line story idea in Chinese or English
  --story-file Path to a text file containing the story idea
  --stories-dir Directory to scan for the latest .txt story file (default: ai-video/stories)
  --output   Directory to write the generated config and starter pack (default: ai-video/output/<story-name>)
  --title    Optional project title
  --preset   Optional preset: neon-rain | sunset-memory | quiet-sci-fi
  --name     Optional character name
  --help     Show this help message
`);
}

function ensureNonEmpty(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`Expected "${label}" to be a non-empty string.`);
  }

  return value.trim();
}

function ensurePositiveNumber(value, fieldName, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`Expected "${fieldName}" to be a positive number.`);
  }

  return value;
}

function normalizeCharacter(character) {
  if (!character || typeof character !== "object") {
    throw new TypeError('Expected "character" to be an object.');
  }

  return {
    name: ensureNonEmpty(character.name, "character.name"),
    appearance: ensureNonEmpty(character.appearance, "character.appearance"),
    wardrobe: ensureNonEmpty(character.wardrobe, "character.wardrobe"),
    mood: ensureNonEmpty(character.mood, "character.mood"),
    consistencyNotes: ensureNonEmpty(character.consistencyNotes, "character.consistencyNotes"),
  };
}

function normalizeShot(shot, index, normalizedConfig) {
  if (!shot || typeof shot !== "object") {
    throw new TypeError(`Shot ${index + 1} must be an object.`);
  }

  const id = ensureNonEmpty(shot.id ?? String(index + 1).padStart(2, "0"), `shots[${index}].id`);
  const style = typeof shot.style === "string" && shot.style.trim() ? shot.style.trim() : normalizedConfig.visualStyle;
  const environment =
    typeof shot.environment === "string" && shot.environment.trim()
      ? shot.environment.trim()
      : normalizedConfig.environmentNotes;
  const editPurpose =
    typeof shot.editPurpose === "string" && shot.editPurpose.trim()
      ? shot.editPurpose.trim()
      : index === 0
        ? "Hook"
        : index === normalizedConfig.shotsRaw.length - 1
          ? "Ending beat"
          : "Emotional progression";

  return {
    id,
    subject: ensureNonEmpty(shot.subject, `shots[${index}].subject`),
    scene: ensureNonEmpty(shot.scene, `shots[${index}].scene`),
    action: ensureNonEmpty(shot.action, `shots[${index}].action`),
    camera: ensureNonEmpty(shot.camera, `shots[${index}].camera`),
    style,
    environment,
    durationSeconds: ensurePositiveNumber(shot.durationSeconds, `shots[${index}].durationSeconds`, 5),
    editPurpose,
    narration:
      typeof shot.narration === "string" && shot.narration.trim() ? shot.narration.trim() : "No narration by default.",
    subtitle: typeof shot.subtitle === "string" && shot.subtitle.trim() ? shot.subtitle.trim() : "",
    sfx: typeof shot.sfx === "string" && shot.sfx.trim() ? shot.sfx.trim() : "Subtle ambience only.",
  };
}

export function normalizeConfig(config) {
  if (!config || typeof config !== "object") {
    throw new TypeError("Config must be a JSON object.");
  }

  const normalized = {
    title: ensureNonEmpty(config.title, "title"),
    logline: ensureNonEmpty(config.logline, "logline"),
    aspectRatio:
      typeof config.aspectRatio === "string" && config.aspectRatio.trim()
        ? config.aspectRatio.trim()
        : DEFAULTS.aspectRatio,
    targetDurationSeconds: ensurePositiveNumber(
      config.targetDurationSeconds,
      "targetDurationSeconds",
      DEFAULTS.targetDurationSeconds
    ),
    platform:
      typeof config.platform === "string" && config.platform.trim() ? config.platform.trim() : DEFAULTS.platform,
    language:
      typeof config.language === "string" && config.language.trim() ? config.language.trim() : DEFAULTS.language,
    visualStyle: ensureNonEmpty(config.visualStyle, "visualStyle"),
    musicStyle:
      typeof config.musicStyle === "string" && config.musicStyle.trim() ? config.musicStyle.trim() : DEFAULTS.musicStyle,
    colorPalette:
      typeof config.colorPalette === "string" && config.colorPalette.trim()
        ? config.colorPalette.trim()
        : DEFAULTS.colorPalette,
    environmentNotes:
      typeof config.environmentNotes === "string" && config.environmentNotes.trim()
        ? config.environmentNotes.trim()
        : "Keep the same primary location across all shots.",
    motionRule:
      typeof config.motionRule === "string" && config.motionRule.trim() ? config.motionRule.trim() : DEFAULTS.motionRule,
    exportSpec:
      typeof config.exportSpec === "string" && config.exportSpec.trim() ? config.exportSpec.trim() : DEFAULTS.exportSpec,
    character: normalizeCharacter(config.character),
    shotsRaw: Array.isArray(config.shots) ? config.shots : null,
  };

  if (!normalized.shotsRaw || normalized.shotsRaw.length === 0) {
    throw new TypeError('Expected "shots" to be a non-empty array.');
  }

  normalized.shots = normalized.shotsRaw.map((shot, index) => normalizeShot(shot, index, normalized));
  delete normalized.shotsRaw;
  return normalized;
}

function buildCharacterSummary(character) {
  return [
    `- Name: ${character.name}`,
    `- Appearance: ${character.appearance}`,
    `- Wardrobe: ${character.wardrobe}`,
    `- Mood baseline: ${character.mood}`,
    `- Consistency rule: ${character.consistencyNotes}`,
  ].join("\n");
}

export function buildImagePrompt(config, shot) {
  return [
    `${shot.subject}.`,
    `${shot.scene}.`,
    "Static keyframe, no exaggerated motion.",
    `${config.character.appearance}.`,
    `${config.character.wardrobe}.`,
    `${shot.style}.`,
    `${config.colorPalette}.`,
    "Maintain consistent face, hair, costume, and lighting across all shots.",
    `Aspect ratio ${config.aspectRatio}.`,
  ].join(" ");
}

export function buildMotionPrompt(shot) {
  const environment = shot.environment.replace(/[.\s]+$/, "");
  const style = shot.style.replace(/[.\s]+$/, "");

  return [
    `The subject ${shot.action}.`,
    `Camera ${shot.camera}.`,
    `Environment ${environment}.`,
    `Style ${style}.`,
  ].join(" ");
}

function buildProjectBrief(config) {
  return `# ${config.title}

## One-line Goal

Create a ${config.targetDurationSeconds}-second AI cinematic short for ${config.platform}, using ${config.aspectRatio} framing and a single main character in one primary location.

## Logline

${config.logline}

## Character Lock

${buildCharacterSummary(config.character)}

## Visual Direction

- Primary style: ${config.visualStyle}
- Color palette: ${config.colorPalette}
- Environment rule: ${config.environmentNotes}
- Motion rule: ${config.motionRule}

## Production Defaults

- Aspect ratio: ${config.aspectRatio}
- Target duration: ${config.targetDurationSeconds}s
- Dialogue/subtitles language: ${config.language}
- Music direction: ${config.musicStyle}
- Export target: ${config.exportSpec}

## Execution Path

1. Generate one key image per shot.
2. Turn each key image into a 5-10 second AI video clip.
3. Keep only the cleanest take for each shot.
4. Assemble the final cut in CapCut with simple cuts or short fades.
5. Add BGM, ambience, subtitles, and a light grade at the end.
`;
}

function buildShotList(config) {
  const lines = [
    `# ${config.title} Shot List`,
    "",
    "| Shot ID | Subject | Scene | Action | Camera | Style | Duration | Purpose |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const shot of config.shots) {
    lines.push(
      `| ${shot.id} | ${shot.subject} | ${shot.scene} | ${shot.action} | ${shot.camera} | ${shot.style} | ${shot.durationSeconds}s | ${shot.editPurpose} |`
    );
  }

  return `${lines.join("\n")}\n`;
}

function buildVideoPrompts(config) {
  const sections = [`# ${config.title} Video Prompt Pack`, ""];

  for (const shot of config.shots) {
    sections.push(`## Shot ${shot.id}`);
    sections.push("");
    sections.push(`- Subject: ${shot.subject}`);
    sections.push(`- Scene: ${shot.scene}`);
    sections.push(`- Action: ${shot.action}`);
    sections.push(`- Camera: ${shot.camera}`);
    sections.push(`- Style: ${shot.style}`);
    sections.push(`- Duration: ${shot.durationSeconds}s`);
    sections.push(`- Aspect Ratio: ${config.aspectRatio}`);
    sections.push("");
    sections.push("### Key Image Prompt");
    sections.push("");
    sections.push(buildImagePrompt(config, shot));
    sections.push("");
    sections.push("### Motion Prompt");
    sections.push("");
    sections.push(buildMotionPrompt(shot));
    sections.push("");
    sections.push("### Generation Notes");
    sections.push("");
    sections.push("- Try 3-5 generations and keep the most stable take.");
    sections.push("- Keep one core action only; do not stack multiple gestures.");
    sections.push("- Reject outputs with face drift, hand glitches, or strong background flicker.");
    sections.push("");
  }

  return `${sections.join("\n")}\n`;
}

function buildCapCutPlan(config) {
  const lines = [
    `# ${config.title} CapCut Edit Plan`,
    "",
    "## Assembly Rules",
    "",
    "- Use straight cuts by default; only use a short fade when a cut feels too abrupt.",
    "- Keep the first shot visually striking within the first 1-2 seconds.",
    "- Let the middle shots carry emotional progression instead of plot complexity.",
    "- End on a pause, turn, or unresolved emotion rather than an over-explained beat.",
    "",
    "## Shot-by-Shot Edit Notes",
    "",
  ];

  for (const shot of config.shots) {
    lines.push(`### Shot ${shot.id}`);
    lines.push("");
    lines.push(`- Edit purpose: ${shot.editPurpose}`);
    lines.push(`- Clip target: ${shot.durationSeconds}s`);
    lines.push(`- Suggested subtitle: ${shot.subtitle || "Optional; only add if it strengthens the hook."}`);
    lines.push(`- Suggested SFX: ${shot.sfx}`);
    lines.push(`- Narration note: ${shot.narration}`);
    lines.push("");
  }

  lines.push("## Packaging");
  lines.push("");
  lines.push(`- Music bed: ${config.musicStyle}`);
  lines.push("- Add ambience first, then music, then subtitles.");
  lines.push("- Apply light contrast and highlight control; avoid heavy LUT stacking.");
  lines.push(`- Export delivery: ${config.exportSpec}`);
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function buildChecklist(config) {
  return `# ${config.title} Production Checklist

## Before Generation

- [ ] Story fits within ${config.targetDurationSeconds}s.
- [ ] Only one main character is on screen.
- [ ] The project keeps one main location throughout the piece.
- [ ] Every shot uses one core action only.
- [ ] Character consistency notes are fixed before generation starts.

## During Video Generation

- [ ] Each shot has one key image before motion generation.
- [ ] Each shot has 3-5 attempts.
- [ ] At least one take per shot is usable without frame-by-frame repair.
- [ ] Face, hair, wardrobe, and lighting stay mostly consistent.
- [ ] Motion is restrained and readable.

## Before Export

- [ ] The final cut is between 15 and 30 seconds.
- [ ] The opening hook lands in the first 1-2 seconds.
- [ ] The story reads as one coherent emotional moment.
- [ ] Music, ambience, subtitles, and basic grading are applied.
- [ ] At least 70% of generated shots are clean enough for direct use.
`;
}

function csvEscape(value) {
  const text = String(value);
  if (/[,"\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

function buildShotsCsv(config) {
  const header = ["shot_id", "subject", "scene", "action", "camera", "style", "duration_seconds", "purpose"];
  const rows = config.shots.map((shot) =>
    [shot.id, shot.subject, shot.scene, shot.action, shot.camera, shot.style, shot.durationSeconds, shot.editPurpose]
      .map(csvEscape)
      .join(",")
  );

  return `${header.join(",")}\n${rows.join("\n")}\n`;
}

export function buildStarterPack(configInput) {
  const config = normalizeConfig(configInput);

  return {
    config,
    files: {
      "00-project-brief.md": buildProjectBrief(config),
      "01-shot-list.md": buildShotList(config),
      "02-video-prompts.md": buildVideoPrompts(config),
      "03-capcut-edit-plan.md": buildCapCutPlan(config),
      "04-production-checklist.md": buildChecklist(config),
      "shots.csv": buildShotsCsv(config),
    },
  };
}

export async function writeStarterPack(configInput, outputDir) {
  const { files, config } = buildStarterPack(configInput);
  await fs.mkdir(outputDir, { recursive: true });

  await Promise.all(
    Object.entries(files).map(([fileName, contents]) =>
      fs.writeFile(path.join(outputDir, fileName), contents, "utf8")
    )
  );

  return { outputDir, fileCount: Object.keys(files).length, title: config.title };
}

function pickPreset(story, explicitPreset) {
  if (explicitPreset) {
    const preset = PRESETS[explicitPreset];
    if (!preset) {
      throw new Error(`Unknown preset: ${explicitPreset}`);
    }

    return preset;
  }

  const lower = story.toLowerCase();
  let bestPreset = PRESETS["neon-rain"];
  let bestScore = -1;

  for (const preset of Object.values(PRESETS)) {
    const score = preset.keywords.reduce((sum, keyword) => sum + (lower.includes(keyword.toLowerCase()) ? 1 : 0), 0);
    if (score > bestScore) {
      bestPreset = preset;
      bestScore = score;
    }
  }

  return bestPreset;
}

function detectGender(story) {
  if (FEMALE_HINTS.some((hint) => story.includes(hint))) return "female";
  if (MALE_HINTS.some((hint) => story.includes(hint))) return "male";
  return "neutral";
}

function defaultCharacterName(gender) {
  if (gender === "female") return "Lin";
  if (gender === "male") return "Jun";
  return "Kai";
}

function characterAppearance(gender, presetKey) {
  if (presetKey === "sunset-memory") {
    if (gender === "female") return "young woman, soft features, natural hair, reflective expression";
    if (gender === "male") return "young man, soft features, natural hair, reflective expression";
    return "young person, soft features, natural hair, reflective expression";
  }

  if (presetKey === "quiet-sci-fi") {
    if (gender === "female") return "young woman, calm expression, clean silhouette, focused eyes";
    if (gender === "male") return "young man, calm expression, clean silhouette, focused eyes";
    return "young person, calm expression, clean silhouette, focused eyes";
  }

  if (gender === "female") return "young woman, sharp bob haircut, pale skin, restrained expression";
  if (gender === "male") return "young man, short dark hair, pale skin, restrained expression";
  return "young person, clean silhouette, pale skin, restrained expression";
}

function characterWardrobe(presetKey) {
  if (presetKey === "sunset-memory") return "simple light jacket, casual trousers, understated details";
  if (presetKey === "quiet-sci-fi") return "minimal futuristic coat, clean dark layers, subtle metallic accents";
  return "dark long coat, understated boots, minimal accessories";
}

function buildTitle(story, explicitTitle, preset) {
  if (explicitTitle) return ensureNonEmpty(explicitTitle, "title");

  const cleaned = story
    .replace(/[，。！？,.!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return preset.titleHint;

  if (/[\u4e00-\u9fff]/.test(cleaned)) {
    return cleaned.slice(0, 12) || preset.titleHint;
  }

  const words = cleaned.split(" ").slice(0, 4);
  return words.map((word) => word.slice(0, 1).toUpperCase() + word.slice(1)).join(" ");
}

function chooseEndingAction(story) {
  if (WALK_AWAY_HINTS.some((hint) => story.toLowerCase().includes(hint.toLowerCase()))) {
    return {
      action: "turns and walks away with calm, restrained motion",
      camera: "short follow shot from behind",
      subtitle: "这一次，终于往前走了。",
    };
  }

  if (LOOK_BACK_HINTS.some((hint) => story.toLowerCase().includes(hint.toLowerCase()))) {
    return {
      action: "looks back over the shoulder and holds the gaze for a beat",
      camera: "slow push-in from a slight rear angle",
      subtitle: "原来最难放下的，一直都在身后。",
    };
  }

  return {
    action: "takes a small breath and lets the emotion settle before moving on",
    camera: "locked medium shot with subtle drift",
    subtitle: "",
  };
}

function chooseMiddleAction(story, preset) {
  const lower = story.toLowerCase();

  if (lower.includes("抬头") || lower.includes("look up")) {
    return "slowly raises the head and looks ahead";
  }
  if (LOOK_BACK_HINTS.some((hint) => lower.includes(hint.toLowerCase()))) {
    return "turns slightly as if hearing something behind";
  }

  return preset.middleAction;
}

function storyMoodLabel(presetKey) {
  if (presetKey === "sunset-memory") return "warm, nostalgic, quietly emotional";
  if (presetKey === "quiet-sci-fi") return "calm, focused, slightly mysterious";
  return "quiet, observant, emotionally contained";
}

export function buildBeginnerConfig({ story, title, preset: explicitPreset, name }) {
  const safeStory = ensureNonEmpty(story, "story");
  const preset = pickPreset(safeStory, explicitPreset);
  const gender = detectGender(safeStory);
  const characterName = name ? ensureNonEmpty(name, "name") : defaultCharacterName(gender);
  const ending = chooseEndingAction(safeStory);

  return {
    title: buildTitle(safeStory, title, preset),
    logline: safeStory,
    aspectRatio: "9:16",
    targetDurationSeconds: 18,
    platform: "Douyin / Reels / Shorts",
    language: "zh-CN",
    visualStyle: preset.visualStyle,
    musicStyle: preset.musicStyle,
    colorPalette: preset.colorPalette,
    environmentNotes: preset.environmentNotes,
    motionRule: preset.motionRule,
    exportSpec: preset.exportSpec,
    character: {
      name: characterName,
      appearance: characterAppearance(gender, preset.key),
      wardrobe: characterWardrobe(preset.key),
      mood: storyMoodLabel(preset.key),
      consistencyNotes: "Keep the same face shape, hairstyle, outfit silhouette, and key lighting ratio across all shots.",
    },
    shots: [
      {
        id: "01",
        subject: `${characterName} ${preset.openingSubject}`,
        scene: preset.baseScene,
        action: preset.openingAction,
        camera: "slow push-in",
        style: preset.visualStyle,
        durationSeconds: 5,
        editPurpose: "Hook",
        subtitle: preset.openingSubtitle,
        sfx: preset.key === "quiet-sci-fi" ? "Soft machine hum and distant interface pulse" : "Light ambience only",
      },
      {
        id: "02",
        subject: `${characterName} ${preset.middleSubject}`,
        scene: preset.baseScene,
        action: chooseMiddleAction(safeStory, preset),
        camera: "slight handheld texture with a gentle push-in",
        style: preset.visualStyle,
        durationSeconds: 5,
        editPurpose: "Emotional progression",
        subtitle: preset.middleSubtitle,
        sfx: preset.key === "sunset-memory" ? "Soft wind and distant birds" : "Subtle ambient texture",
      },
      {
        id: "03",
        subject: `${characterName} ${preset.endingSubject}`,
        scene: preset.baseScene,
        action: ending.action,
        camera: ending.camera,
        style: preset.visualStyle,
        durationSeconds: 6,
        editPurpose: "Ending beat",
        subtitle: ending.subtitle || preset.endingSubtitle,
        sfx: preset.key === "neon-rain" ? "Passing tires on wet pavement" : "Subtle movement and room tone",
      },
    ],
  };
}

export async function writeBeginnerStarter(options) {
  const storyInput = await resolveStoryInput(options);
  const story = storyInput.story;
  const config = normalizeConfig(buildBeginnerConfig({ ...options, story }));
  const configHash = computeConfigHash(config);
  const projectSlug = slugify(storyInput.storyNameHint || config.title, "starter-pack");
  const outputDir = options.output
    ? ensureNonEmpty(options.output, "output")
    : path.join(DEFAULT_OUTPUT_DIR, projectSlug);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, "00-story-config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(outputDir, "00-story.txt"), `${story}\n`, "utf8");
  const result = await writeStarterPack(config, outputDir);

  return {
    ...result,
    config,
    configHash,
    projectSlug,
    story,
    preset: pickPreset(story, options.preset).key,
    sourceFile: storyInput.storyFile ?? null,
    outputDir,
  };
}

export async function resolveStoryInput(options) {
  if (typeof options.story === "string" && options.story.trim()) {
    return {
      story: options.story.trim(),
      storyFile: null,
      storyNameHint: options.title || "inline-story",
    };
  }

  if (typeof options.storyFile === "string" && options.storyFile.trim()) {
    const storyFile = options.storyFile.trim();
    const raw = await fs.readFile(storyFile, "utf8");
    return {
      story: ensureNonEmpty(raw, "story file content"),
      storyFile,
      storyNameHint: path.basename(storyFile, path.extname(storyFile)),
    };
  }

  const storiesDir = typeof options.storiesDir === "string" && options.storiesDir.trim()
    ? options.storiesDir.trim()
    : DEFAULT_STORIES_DIR;
  const latestStoryFile = await findLatestStoryFile(storiesDir);
  const raw = await fs.readFile(latestStoryFile, "utf8");

  return {
    story: ensureNonEmpty(raw, "story file content"),
    storyFile: latestStoryFile,
    storyNameHint: path.basename(latestStoryFile, path.extname(latestStoryFile)),
  };
}

async function findLatestStoryFile(storiesDir) {
  let entries;

  try {
    entries = await fs.readdir(storiesDir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error(
        `No story input provided, and the default stories directory "${storiesDir}" does not exist.`
      );
    }

    throw error;
  }

  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".txt"))
      .map(async (entry) => {
        const filePath = path.join(storiesDir, entry.name);
        const stats = await fs.stat(filePath);
        return { filePath, mtimeMs: stats.mtimeMs };
      })
  );

  if (files.length === 0) {
    throw new Error(`No .txt story files found in "${storiesDir}".`);
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0].filePath;
}

export function slugify(value, fallback) {
  const asciiSlug = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  if (asciiSlug) return asciiSlug;
  return fallback;
}

export function computeConfigHash(config) {
  return crypto.createHash("sha256").update(JSON.stringify(normalizeConfig(config))).digest("hex");
}

export async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.help) {
    printHelp();
    return null;
  }

  const { runAiVideoPipeline } = await import("./pipeline.mjs");
  return runAiVideoPipeline(args);
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
