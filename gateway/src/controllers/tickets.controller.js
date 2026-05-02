const ticketService = require('../services/ticket.service');

async function submit(req, res, next) {
  try {
    const result = await ticketService.submitTicket(req.body);
    res.status(201).json(result);
  } catch (err) { next(err); }
}

async function list(req, res, next) {
  try {
    // req.query already parsed + validated by Zod middleware
    const result = await ticketService.listTickets(req.query);
    res.json(result);
  } catch (err) { next(err); }
}

async function getDetail(req, res, next) {
  try {
    const result = await ticketService.getTicketDetail(req.params.ticketKey);
    res.json(result);
  } catch (err) { next(err); }
}

module.exports = { submit, list, getDetail };
