import { authorize, createMailbox, reportError, requestBody, requestedTask, respond, validateSubmission } from './_codex-bridge.mjs';

export function createHandler({ fetchImpl = globalThis.fetch, env = process.env, now } = {}) {
  return async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return respond(res, 405, { error: 'method_not_allowed' });
    }
    try {
      authorize(req, env);
      const mailbox = createMailbox({ fetchImpl, env, now });
      if (req.method === 'GET') {
        const taskId = requestedTask(req);
        await mailbox.privateRepository();
        return respond(res, 200, await mailbox.result(taskId));
      }
      const body = requestBody(req, ['taskId', 'body']);
      validateSubmission(body.taskId, body.body, env);
      await mailbox.privateRepository();
      await mailbox.submit(body.taskId, body.body);
      return respond(res, 202, { taskId: body.taskId, status: 'queued' });
    } catch (error) { return reportError(res, error); }
  };
}

export default createHandler();
