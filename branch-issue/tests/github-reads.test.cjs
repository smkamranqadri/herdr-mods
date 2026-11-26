const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../mods/branch-issue/github/reads.js'), 'utf8')
  .replace(/^import .*;$/m, '').replace(/^export /m, '') + '\nreadGitHubIssues;';
const space = { folder: '/remote/worktree', machine: 'ssh-box' };
const sha = 'a'.repeat(40);
const success = (stdout = '') => ({ code: 0, stdout, stderr: '' });
const json = (value) => success(JSON.stringify(value));
const error = (stderr = '') => ({ code: 1, stdout: '', stderr });
const list = (...rows) => success(rows.map((row) => JSON.stringify(row)).join('\n'));
const issue = (number, title = `Issue ${number}`) => ({ number, title });
const item = (repository, number) => ({ ...issue(number), repository, url: `https://github.com/${repository}/issues/${number}` });
const page = (repository) => ({ data: { repository } });
const prHeads = (...nodes) => json([page({ pullRequests: { nodes } })]);
const links = (...pages) => json(pages.map((nodes) => page({ pullRequest: { closingIssuesReferences: { nodes } } })));
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);

function harness({ branch = 'fix', remotes = { origin: 'git@github.com:fork/project.git' }, config = {}, gh } = {}) {
  const calls = [];
  const read = vm.runInNewContext(source, { exec: async (bin, args, options) => {
    if (bin === 'git') {
      same(options, { cwd: space.folder, on: space.machine });
      if (args[0] === 'symbolic-ref') return branch ? success(`refs/heads/${branch}`) : error();
      if (args[0] === 'rev-parse') return success(sha);
      if (args[0] === 'config') {
        const value = config[args[2].slice(`branch.${branch}.`.length)];
        return value ? success(value) : error();
      }
      if (args[0] === 'remote' && args.length === 1) return success(Object.keys(remotes).join('\n'));
      if (args[0] === 'remote' && args[1] === 'get-url') return success(remotes[args.at(-1)]);
    }
    assert.equal(bin, 'gh');
    same(args.slice(0, 3), ['api', '--hostname', 'github.com']);
    assert.equal(options, undefined);
    const [endpoint, ...flags] = args.slice(3);
    calls.push([endpoint, flags]);
    if (gh) {
      const response = gh(endpoint, flags);
      if (response) return response;
    }
    if (endpoint === 'graphql' && flags.some((arg) => arg.includes('pullRequests('))) return prHeads();
    if (/\/issues$/.test(endpoint)) return list();
    assert.fail(`Unexpected GitHub request: ${endpoint} ${flags}`);
  } });
  return { read: () => read(space), calls };
}

test('open issues prefer the tracked checkout repository and require paginated issue-only output', async () => {
  const { read } = harness({ branch: 'fix', config: { remote: 'work' }, remotes: {
    work: 'ssh://git@github.com:22/our/work.git', origin: 'https://github.com/fork/project.git',
    upstream: 'https://github.com/up/project.git',
  }, gh(endpoint, flags) {
    if (endpoint === 'graphql') return;
    assert.equal(endpoint, 'repos/our/work/issues');
    assert.ok(flags.includes('--paginate'));
    assert.ok(flags.includes('state=open'));
    assert.ok(flags.includes('.[] | select(has("pull_request") | not) | {number,title}'));
    return list({ ...issue(1), html_url: 'javascript:bad' }, issue(9));
  } });
  same(await read(), { repository: 'our/work', items: [item('our/work', 1), item('our/work', 9)], linked: [] });
});

test('detached checkout falls back past unsupported origins and does not look up a PR', async () => {
  const { read, calls } = harness({ branch: '', remotes: {
    origin: 'https://github.com.evil.test/fork/project', upstream: 'https://github.com/up/project.git',
  } });
  same(await read(), { repository: 'up/project', items: [], linked: [] });
  same(calls.map(([endpoint]) => endpoint), ['repos/up/project/issues']);
});

test('uses closing references only from the proven same-name tracking PR; retains closed cross-repo links', async () => {
  const branch = 'fix/other/bugs#15/OTHER/bugs#15';
  const head = (number, nameWithOwner, over = {}) => ({
    number, state: 'OPEN', headRefName: branch, headRefOid: 'ahead', headRepository: { nameWithOwner }, ...over,
  });
  const ref = (number, nameWithOwner) => ({ ...issue(number), repository: { nameWithOwner } });
  const { read, calls } = harness({ branch, config: { remote: 'origin', merge: `refs/heads/${branch}` }, remotes: {
    origin: 'git@github.com:fork/project.git', upstream: 'https://github.com/up/project.git',
  }, gh(endpoint, flags) {
    if (endpoint !== 'graphql') return;
    assert.ok(flags.includes('--paginate'));
    assert.ok(flags.includes('--slurp'));
    if (flags.some((arg) => arg.includes('pullRequests('))) {
      return flags.includes('owner=up') ? prHeads(
        head(5, 'unrelated/project', { headRefOid: sha }),
        head(6, 'up/project', { headRefOid: sha }),
        head(7, 'fork/project', { headRefName: 'other' }),
        head(8, 'Fork/Project'),
        head(9, 'Fork/Project', { state: 'MERGED', headRefOid: 'old' }),
      ) : prHeads();
    }
    assert.ok(flags.includes('number=8'));
    assert.ok(flags.some((arg) => arg.includes('closingIssuesReferences(')));
    return links([ref(15, 'other/bugs')], [ref(15, 'Other/Bugs'), ref(19, 'second/repo')]);
  } });
  const result = await read();
  same(result.linked, [item('Other/Bugs', 15), item('second/repo', 19)]);
  assert.equal(result.linkedWarning, undefined);
  assert.ok(!calls.some(([endpoint]) => /\/issues\/\d+$/.test(endpoint)));
});

test('explicit refs skip misses, PR numbers and bare or ambiguous branch numbers', async () => {
  const { read, calls } = harness({ branch: 'issue-23/#27/other/bugs#31/other/bugs#32/other/bugs#33/other/bugs#34abc/wrong_owner/repo#35', gh(endpoint) {
    if (endpoint === 'repos/other/bugs/issues/31') return error('gh: Not Found (HTTP 404)');
    if (endpoint === 'repos/other/bugs/issues/32') return json({ ...issue(32), pull_request: {} });
    if (endpoint === 'repos/other/bugs/issues/33') return json({ ...issue(33), state: 'closed' });
  } });
  same(await read(), { repository: 'fork/project', items: [], linked: [item('other/bugs', 33)] });
  same(calls.map(([endpoint]) => endpoint).filter((endpoint) => /\/issues\/\d+$/.test(endpoint)), [
    'repos/other/bugs/issues/31', 'repos/other/bugs/issues/32', 'repos/other/bugs/issues/33',
  ]);
});

test('untracked branch ignores PRs with differing commits or ambiguous same-ref/SHA forks', async () => {
  const head = (number, nameWithOwner, headRefOid = sha) => ({
    number, headRefName: 'fix', headRefOid, headRepository: { nameWithOwner },
  });
  const { read } = harness({ remotes: { origin: 'git@github.com:fork/project.git', upstream: 'git@github.com:up/project.git' },
    gh(endpoint, flags) {
      if (endpoint !== 'graphql') return;
      assert.ok(flags.some((arg) => arg.includes('pullRequests(')));
      return prHeads(head(4, 'fork/project'), head(5, 'up/project'), head(6, 'fork/project', 'different'));
    },
  });
  same((await read()).linked, []);
});

test('a worktree binding is used only when the PR head still identifies its checkout', async () => {
  for (const [head, expected] of [[sha, [item('other/bugs', 2)]], ['different', []]]) {
    const { read } = harness({ branch: 'local-alias', config: { 'herdr-pr': 'up/project#6' }, gh(endpoint, flags) {
      if (endpoint === 'repos/up/project/pulls/6') return json({ head: { sha: head } });
      if (endpoint === 'graphql' && flags.includes('number=6')) {
        assert.equal(head, sha);
        return links([{ ...issue(2), repository: { nameWithOwner: 'other/bugs' } }]);
      }
    } });
    same((await read()).linked, expected);
  }
});

test('distinguishes unsupported remote, absent/invalid auth and list API errors', async () => {
  const unsupported = harness({ remotes: { origin: 'https://gitlab.test/fork/project' } });
  await assert.rejects(unsupported.read, /No supported github\.com remote/);
  assert.equal(unsupported.calls.length, 0);
  for (const [stderr, pattern] of [
    ['Run gh auth login', /not authenticated.*GH_TOKEN/],
    ['gh: Bad credentials (HTTP 401)', /not authenticated/],
    ['gh: Not Found (HTTP 404)', /GitHub request failed/],
    ['could not resolve host', /GitHub request failed/],
  ]) {
    const { read } = harness({ gh(endpoint) { if (/\/issues$/.test(endpoint)) return error(stderr); } });
    await assert.rejects(read, pattern);
  }
});

test('a real link lookup failure warns without hiding the successful open issue list', async () => {
  const { read } = harness({ branch: 'other/bugs#15', gh(endpoint) {
    if (endpoint === 'graphql') return error('connection failed');
    if (endpoint === 'repos/other/bugs/issues/15') return json(issue(15));
    return list(issue(4));
  } });
  const result = await read();
  same(result.items, [item('fork/project', 4)]);
  same(result.linked, [item('other/bugs', 15)]);
  assert.match(result.linkedWarning, /GitHub request failed/);
});
