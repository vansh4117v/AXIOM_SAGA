const promptService = require('../services/prompt.service');

async function getAll(req, res, next) {
  try {
    const result = await promptService.getAllPrompts();
    res.json(result);
  } catch (err) { next(err); }
}

async function getByAgent(req, res, next) {
  try {
    const result = await promptService.getPromptByAgent(req.params.agent);
    res.json(result);
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  try {
    const updatedBy = req.user?.username || 'unknown';
    const result = await promptService.updatePrompt(
      req.params.agent,
      req.body.system_prompt,
      updatedBy
    );
    res.json(result);
  } catch (err) { next(err); }
}

module.exports = { getAll, getByAgent, update };
