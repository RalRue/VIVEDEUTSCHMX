#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MAILBOX_OWNER = 'RalRue';
export const MAILBOX_NAME = 'VIVEDEUTSCHMX-CODEX-BRIDGE';
export const MAILBOX_REPOSITORY = `${MAILBOX_OWNER}/${MAILBOX_NAME}`;
export const MAILBOX_URL = `https://github.com/${MAILBOX_REPOSITORY}`;
const REPOSITORY_ENDPOINT = `repos/${MAILBOX_REPOSITORY}`;
const METADATA_PROJECTION = '{full_name: .full_name, private: .private, html_url: .html_url}';

export class GitHubApiError extends Error {
  constructor(status = null, kind = 'request') {
    super('GitHub request failed.');
    this.name = 'GitHubApiError';
    this.status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
    this.kind = kind;
  }
}

export class MailboxSetupError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'MailboxSetupError';
    this.code = code;
  }
}

function runGh(program, args, options) {
  return new Promise((accept, reject) => {
    execFile(program, args, options, (error, stdout, stderr) => {
      if (error) {
        // Kept only for status extraction. Upstream diagnostics are never printed.
        error.stderr = stderr;
        reject(error);
      } else accept({ stdout, stderr });
    });
  });
}

function responseStatus(error) {
  const stderr = typeof error?.stderr === 'string' ? error.stderr
    : Buffer.isBuffer(error?.stderr) ? error.stderr.toString('utf8') : '';
  const matches = [...stderr.matchAll(/\(HTTP ([1-5][0-9]{2})\)/g)];
  // Ambiguous or absent diagnostics cannot establish a missing repository.
  return matches.length === 1 ? Number(matches[0][1]) : null;
}

export function createGitHubRequest({ run = runGh, env = process.env } = {}) {
  return async function request(method, endpoint, fields) {
    if (!['GET', 'POST'].includes(method)
      || ![REPOSITORY_ENDPOINT, 'user', 'user/repos'].includes(endpoint)) {
      throw new GitHubApiError(null, 'request');
    }
    const childEnv = { ...env, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1' };
    if (typeof env.VIVE_GITHUB_ADMIN_TOKEN === 'string' && env.VIVE_GITHUB_ADMIN_TOKEN.length > 0) {
      childEnv.GH_TOKEN = env.VIVE_GITHUB_ADMIN_TOKEN;
    }
    delete childEnv.VIVE_GITHUB_ADMIN_TOKEN;
    delete childEnv.GH_DEBUG;
    const args = ['api', '--hostname', 'github.com', '--method', method, endpoint];
    if (fields !== undefined) {
      for (const [name, value] of Object.entries(fields)) {
        if (typeof value === 'boolean') args.push('--field', `${name}=${value}`);
        else args.push('--raw-field', `${name}=${value}`);
      }
    }
    args.push('--jq', endpoint === 'user' ? '{login: .login}' : METADATA_PROJECTION);
    let output;
    try {
      output = await run('gh', args, { env: childEnv, encoding: 'utf8', timeout: 30_000,
        killSignal: 'SIGKILL', maxBuffer: 65_536 });
    } catch (error) {
      throw new GitHubApiError(responseStatus(error), error?.code === 'ENOENT' ? 'executable' : 'request');
    }
    try {
      const text = typeof output?.stdout === 'string' ? output.stdout
        : Buffer.isBuffer(output?.stdout) ? output.stdout.toString('utf8') : null;
      if (text === null) throw new Error();
      return JSON.parse(text);
    } catch {
      throw new GitHubApiError(null, 'metadata');
    }
  };
}

export const githubRequest = createGitHubRequest();

function statusOf(error) {
  return Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? error.status : null;
}

function unavailable(error, operation) {
  if (error instanceof GitHubApiError && error.kind === 'executable') {
    return new MailboxSetupError('GitHub CLI (gh) is required. Install it and rerun this command; existing GitHub authentication is reused.', 'gh-missing');
  }
  const status = statusOf(error);
  if (status === 401 || status === 403) {
    return new MailboxSetupError(`GitHub ${operation} was denied (HTTP ${status}). The current GitHub integration cannot complete this operation. `
      + 'If needed, supply VIVE_GITHUB_ADMIN_TOKEN securely in environment settings with access for RalRue to create private repositories; never put its value in chat.', 'access-denied');
  }
  return new MailboxSetupError(`GitHub ${operation} could not be confirmed${status === null ? '' : ` (HTTP ${status})`}. `
    + 'Check GitHub connectivity and access, then rerun --check.', 'request-unconfirmed');
}

function ready(metadata, created) {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)
    || metadata.full_name !== MAILBOX_REPOSITORY || metadata.html_url !== MAILBOX_URL
    || typeof metadata.private !== 'boolean') {
    throw new MailboxSetupError('GitHub returned unexpected mailbox metadata. Rerun --check to verify the private mailbox.', 'metadata-invalid');
  }
  if (metadata.private !== true) {
    throw new MailboxSetupError('The mailbox repository exists but is PUBLIC. Refusing to use it or change its visibility; private storage is required.', 'mailbox-public');
  }
  return { status: 'ready', repository: MAILBOX_REPOSITORY, url: MAILBOX_URL, private: true, created };
}

export async function ensureMailbox({ check = false, request = githubRequest } = {}) {
  try {
    return ready(await request('GET', REPOSITORY_ENDPOINT), false);
  } catch (error) {
    if (error instanceof MailboxSetupError) throw error;
    if (statusOf(error) !== 404) throw unavailable(error, 'mailbox check');
  }
  if (check) {
    throw new MailboxSetupError('The private mailbox is unavailable (HTTP 404). Run this command without --check to create it using an authorized RalRue account.', 'mailbox-missing');
  }
  let account;
  try { account = await request('GET', 'user'); }
  catch (error) { throw unavailable(error, 'account verification'); }
  if (account === null || typeof account !== 'object' || typeof account.login !== 'string'
    || account.login.toLowerCase() !== MAILBOX_OWNER.toLowerCase()) {
    throw new MailboxSetupError('The authenticated GitHub account is not RalRue. Refusing to create a mailbox under another account. '
      + 'Supply VIVE_GITHUB_ADMIN_TOKEN securely in environment settings for the authorized RalRue account.', 'account-mismatch');
  }
  const fields = { name: MAILBOX_NAME, private: true, auto_init: false,
    description: 'Private mailbox for VIVE Codex helpers.' };
  let metadata;
  try { metadata = await request('POST', 'user/repos', fields); }
  catch (error) {
    if (statusOf(error) !== 422) throw unavailable(error, 'private mailbox creation');
    // Another process may have created it after our initial read. Recheck privacy.
    try { return ready(await request('GET', REPOSITORY_ENDPOINT), false); }
    catch (recheckError) {
      if (recheckError instanceof MailboxSetupError) throw recheckError;
      throw unavailable(recheckError, 'mailbox creation recheck');
    }
  }
  return ready(metadata, true);
}

export function helpText() {
  return `Create or verify the dedicated private VIVE Codex mailbox.\n\n`
    + `  node scripts/codex-bridge-connect.mjs          Verify; create only if missing and account is RalRue\n`
    + `  node scripts/codex-bridge-connect.mjs --check  Verify without creating anything\n\n`
    + `Mailbox: ${MAILBOX_REPOSITORY}. Requires GitHub CLI (gh).\n`
    + `Existing GitHub authentication is reused. Optional secure environment setting:\n`
    + `VIVE_GITHUB_ADMIN_TOKEN for an authorized RalRue account that can create private repositories.\n`
    + `The token is passed only to gh; its value is never printed.\n`
    + `No Git checkout, clone, push, visibility change or repository initialization is performed.\n`;
}

export async function main(args = process.argv.slice(2), { request = githubRequest, stdout = text => process.stdout.write(text) } = {}) {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    stdout(helpText());
    return;
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    throw new MailboxSetupError('Unknown option. See --help.', 'usage');
  }
  const result = await ensureMailbox({ check: args[0] === '--check', request });
  stdout(`${JSON.stringify(result)}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`codex-bridge-connect: ${error instanceof MailboxSetupError ? error.message : 'Mailbox setup failed. Check GitHub access and rerun --check.'}\n`);
    process.exitCode = 1;
  });
}
