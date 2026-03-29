import { runAiVideoPipeline } from "./pipeline.mjs";

runAiVideoPipeline().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
