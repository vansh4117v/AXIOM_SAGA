const express = require("express");
const router = express.Router();
const promptsController = require("../controllers/prompts.controller");
const { authorize } = require("../middleware/auth");
const { zodValidate } = require("../middleware/zodValidate");
const { updatePromptSchema, agentParamSchema } = require("../schemas/prompt.schema");

// GET /prompts — list all agent prompts
router.get("/", promptsController.getAll);

// GET /prompts/:agent — single agent prompt
router.get("/:agent", promptsController.getByAgent);

// PUT /prompts/:agent — update prompt (admin only)
router.put(
  "/:agent",
  authorize("admin"),
  zodValidate(agentParamSchema, "params"),
  zodValidate(updatePromptSchema),
  promptsController.update,
);

module.exports = router;
