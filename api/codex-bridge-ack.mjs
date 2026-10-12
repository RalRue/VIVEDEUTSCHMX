import { authorize, createMailbox, reportError, requestBody, respond, validateAcknowledgement } from './_codex-bridge.mjs';

export function createAckHandler({ fetchImpl = globalThis.fetch, env = process.env, now } = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return respond(res, 405, { error: 'method_not_allowed' });
    }
    try {
      authorize(req, env);
      const body = requestBody(req, ['taskId', 'replyId']);
      validateAcknowledgement(body.taskId, body.replyId);
      const mailbox = createMailbox({ fetchImpl, env, now });
      await mailbox.privateRepository();
      await mailbox.acknowledge(body.taskId, body.replyId);
      return respond(res, 200, { taskId: body.taskId, replyId: body.replyId, acknowledged: true });
    } catch (error) { return reportError(res, error); }
  };
}

export default createAckHandler();
