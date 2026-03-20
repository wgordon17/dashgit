import assert from 'assert';
import fs from "fs"
import { gitHubAdapter } from "../app/GitHubAdapter.js"

beforeEach(function() {
    if (!fs.existsSync("actual")){
        fs.mkdirSync("actual");
    }});

/**
 * Test the (GitHub) adapters taking as input the provider api response from an external file.
 * Test inputs are created by getting real data, removing unneeded fields
 * and customized to represent the test situations.
 */
describe("TestGitHubAdapter - Model transformations from GitHub API results", function () {

    //Rest API
    // - pr assigned, pr reviewer(not assigned), issue
    // - 0,1,2 assignees
    // - 0,1,2 labels
    // - >1 repo, >1 organization
    it("Transform GitHub REST API results", function () {
        let input = JSON.parse(fs.readFileSync("./input/github-rest-result1.json"));
        let provider = { provider: "GitHub", uid: "0-github", user: "usr1", url: 'https://github.com', api: 'https://api.github.com' };
        let actual = gitHubAdapter.workitems2model(provider, input);
        fs.writeFileSync("./actual/github-rest-model1.json", JSON.stringify(actual, null, 2)); //to allow extenal diff
        let expected = JSON.parse(fs.readFileSync("./expected/github-rest-model1.json"));
        assert.deepEqual(expected, actual);
    });

    //Rest API with actions: Same as before, but calling the method to add the actions and then the transformation
    it("Transform GitHub REST API results with actions", function () {
        let input = JSON.parse(fs.readFileSync("./input/github-rest-result1.json"));
        gitHubAdapter.addActionToPullRequestItems(input, "review_request");
        gitHubAdapter.addActionToPullRequestItems(input, "other_action");
        let provider = { provider: "GitHub", uid: "0-github", user: "usr1", url: 'https://github.com', api: 'https://api.github.com' };
        let actual = gitHubAdapter.workitems2model(provider, input);
        fs.writeFileSync("./actual/github-rest-model1-actions.json", JSON.stringify(actual, null, 2)); //to allow extenal diff
        let expected = JSON.parse(fs.readFileSync("./expected/github-rest-model1-actions.json"));
        assert.deepEqual(expected, actual);
    });

    //Data about follow ups is stored in the manager repository, but it is transformed to models as it if where from the GitHub api
    it("Transform GitHub Follow up results from GitStoreApi", function () {
        let input = JSON.parse(fs.readFileSync("./input/gitstore-follow-up-result.json"));
        let provider = { provider: "GitHub", uid: "0-github", user: "usr1", url: 'https://github.com', api: 'https://api.github.com' };
        let actual = gitHubAdapter.workitems2model(provider, input.followUp);
        fs.writeFileSync("./actual/gitstore-follow-up-github-model.json", JSON.stringify(actual, null, 2)); //to allow extenal diff
        let expected = JSON.parse(fs.readFileSync("./expected/gitstore-follow-up-github-model.json"));
        assert.deepEqual(expected, actual);
    });

    // GraphQL API
    [
        // Basic (use a first repo: testrepo), deprecated version V1
        // - pr with branch (63), branch without PR (develop)
        // - all pr statuses: success, failure, pending, not available (63 61 60 59)
        // - branch without PR statuses: only existing (develop) and not available (main)
        // - title pr equal (63)/different (64) of commit (if different uses pr title)
        // - pr dates!=commit dates (all)
        // Focus on other features (different repo: testrepo2)
        // - pr status OPEN(alredy covered)/CLOSED(79)/other(78) (any different to OPEN is managed as a branch)
        { input: "github-graphql-result1.json", expected: "github-graphql-model1.json", graphqlV2: false },

        // Version V2. Uses the same expected model than the previous,
        // but the input is adapted to have the PRs as siblings of the branches
        { input: "github-graphqlV2-result1.json", expected: "github-graphql-model1.json", graphqlV2: true },

        // PR from a fork (baseRepo!=headRepo -> branchUrl is at the forked repo (head) and branchName with fork icon)
        // - no matching branch (fork20)
        // - matching branch by name and title (match20) with PR in my repo (match20) -> show PR and branch
        { input: "github-graphqlV2-result2.json", expected: "github-graphql-model2.json", graphqlV2: true },

        // Postprocessing of the GraphQL query: The user specified repositories are siblings of the viewer node
        // and must be moved to the viewer node and transformed accordingly
        // - more than one, first (userrepo1) and last(userrepo9)
        // - already in the viewer (do not duplicate model) (userrepo2)
        // - without PRs (do not add to the model) (userrepo3)
        { input: "github-graphqlV2-result-user-spec.json", expected: "github-graphql-model-user-spec.json", graphqlV2: true },
    ].forEach(function (item) {
        it(`Transform GitHub GraphQL API results from ${item.input}`, function () {
            let input = JSON.parse(fs.readFileSync(`./input/${item.input}`));
            input = gitHubAdapter.postprocessGraphQl(input);
            let actual = gitHubAdapter.statuses2model({ provider: "GitHub", uid: "0-github", user: "usr1" }, input, item.graphqlV2);
            fs.writeFileSync(`./actual/${item.expected}`, JSON.stringify(actual, null, 2)); //to allow extenal diff
            let expected = JSON.parse(fs.readFileSync(`./expected/${item.expected}`));
            assert.deepEqual(expected, actual);
        });
    });

    // Matching Status coverage of 
    // - all statusCheckRollup values at: https://docs.github.com/en/graphql/reference/enums#statusstate
    // - not defined or not matching any value
    [
        { input: null, expected: "notavailable" },
        { input: undefined, expected: "notavailable" },
        { input: "XXXXX", expected: "notavailable" },
        { input: "ERROR", expected: "failure" },
        { input: "EXPECTED", expected: "pending" },
        { input: "FAILURE", expected: "failure" },
        { input: "PENDING", expected: "pending" },
        { input: "SUCCESS", expected: "success" }
    ].forEach(function (item) {
        it(`GitHub StatusCheckRollup state conversion: ${item.input} to ${item.expected}`, function () {
            assert.equal(item.expected, gitHubAdapter.transformStatus(item.input));
            assert.equal(item.expected, gitHubAdapter.transformStatus(item.input??"".toLowerCase()));
        });
    });

    // Determine what repositories need to be updated since a given date (update requirements)
    // - viewer repos: all, none, one included, one excluded
    // - user spec repos: idem
    // - date is empty string (include all)
    // Check boundaries of date for each repo
    [
        { since: "2024-12-09T14:00:31Z", maxProjects: 0, otherRepos: "" },
        { since: "2024-12-09T14:00:29Z", maxProjects: 1, otherRepos: "" },
        { since: "2024-12-09T13:00:31Z", maxProjects: 1, otherRepos: "" },
        { since: "2024-12-09T13:00:29Z", maxProjects: 1, otherRepos: "user3/userrepo3" },
        { since: "2024-12-09T12:00:31Z", maxProjects: 1, otherRepos: "user3/userrepo3" },
        { since: "2024-12-09T12:00:29Z", maxProjects: 2, otherRepos: "user3/userrepo3" },
        { since: "2024-12-09T11:00:31Z", maxProjects: 2, otherRepos: "user3/userrepo3" },
        { since: "2024-12-09T11:00:29Z", maxProjects: 2, otherRepos: "user3/userrepo3 user4/userrepo4" },
        { since: "", maxProjects: 2, otherRepos: "user3/userrepo3 user4/userrepo4" },
    ].forEach(function (item) {
        it(`Update requirements since "${item.since}" -> ${item.maxProjects} "${item.otherRepos}"`, function () {
            let gqlresponse = JSON.parse(fs.readFileSync(`./input/github-graphqlV2-result-update-reqs.json`));
            assert.equal(item.maxProjects, gitHubAdapter.getNumReposToUpdate(gqlresponse, 2, item.since));
            assert.equal(item.otherRepos, gitHubAdapter.getUserReposToUpdate(gqlresponse, item.since));
        });
    });

});

describe("TestGitHubAdapter - Actions model", function () {
    it("Transform GitHub Actions runs with fixture comparison", function () {
        let input = JSON.parse(fs.readFileSync('./input/github-actions-runs.json'));
        let provider = { provider: 'GitHub', uid: '0-github', user: 'usr1', actions: { maxRunsPerWorkflow: 3 } };
        let actual = gitHubAdapter.actions2model(provider, input, false);
        fs.writeFileSync('./actual/github-actions-model.json', JSON.stringify(actual, null, 2));
        let expected = JSON.parse(fs.readFileSync('./expected/github-actions-model.json'));
        assert.deepEqual(expected, actual);
    });

    it("Basic actions2model transform filters PR events by default", function () {
        let input = JSON.parse(fs.readFileSync('./input/github-actions-runs.json'));
        let provider = { provider: 'GitHub', uid: '0-github', user: 'usr1', actions: { maxRunsPerWorkflow: 3 } };
        let actual = gitHubAdapter.actions2model(provider, input, false);
        // PR event (run_number 43, id 9000020) should be filtered out
        // wf100 non-PR runs sorted by created_at desc: 9000001(42), 9000002(41), 9000003(40), 9000004(39) -> top 3: 42,41,40
        // wf200: 1 run (id 9000010)
        // wf300: 2 runs (id 9000100, 9000101)
        assert.equal(actual.items.length, 6);
        actual.items.forEach(item => {
            assert.notEqual(item.actions.event, "pull_request");
        });
    });

    it("actions2model includes PR events when showPrRuns is true", function () {
        let input = JSON.parse(fs.readFileSync('./input/github-actions-runs.json'));
        let provider = { provider: 'GitHub', uid: '0-github', user: 'usr1', actions: { maxRunsPerWorkflow: 3 } };
        let actual = gitHubAdapter.actions2model(provider, input, true);
        // With PR events, wf100 runs sorted desc: 9000020(43 PR,11:00), 9000001(42,10:00), 9000002(41,09:00), 9000003(40,08:00) -> top 3: 43,42,41
        // wf200: 1 run, wf300: 2 runs
        assert.equal(actual.items.length, 6);
        let prItems = actual.items.filter(i => i.actions.event === "pull_request");
        assert.equal(prItems.length, 1);
    });

    it("actions2model respects maxRunsPerWorkflow", function () {
        let input = JSON.parse(fs.readFileSync('./input/github-actions-runs.json'));
        let provider = { provider: 'GitHub', uid: '0-github', user: 'usr1', actions: { maxRunsPerWorkflow: 1 } };
        let actual = gitHubAdapter.actions2model(provider, input, false);
        // maxRunsPerWorkflow=1: 1 per workflow = wf100(1) + wf200(1) + wf300(1) = 3
        assert.equal(actual.items.length, 3);
    });

    it("actions2model uses run_id for unique iid", function () {
        let input = JSON.parse(fs.readFileSync('./input/github-actions-runs.json'));
        let provider = { provider: 'GitHub', uid: '0-github', user: 'usr1', actions: { maxRunsPerWorkflow: 10 } };
        let actual = gitHubAdapter.actions2model(provider, input, true);
        // All iids should be unique (using run.id, not run_number)
        let iids = actual.items.map(i => i.iid);
        let uniqueIids = new Set(iids);
        assert.equal(uniqueIids.size, iids.length);
    });

    it("actions2model handles empty input", function () {
        let provider = { provider: 'GitHub', uid: '0-github', user: 'usr1', actions: { maxRunsPerWorkflow: 3 } };
        let actual = gitHubAdapter.actions2model(provider, {}, false);
        assert.equal(actual.items.length, 0);
        assert.equal(actual.header.uid, '0-github');
    });

    it("actions2model produces zero items when all runs are PR events and showPrRuns is false", function () {
        let input = { "org/repo": [
            { id: 1, workflow_id: 10, name: "CI", run_number: 1, display_title: "CI",
              status: "completed", conclusion: "success", event: "pull_request",
              head_branch: "pr-branch", actor: { login: "user" },
              html_url: "https://github.com/org/repo/actions/runs/1",
              run_started_at: "2026-01-01T00:00:00Z",
              created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:01:00Z" }
        ]};
        let provider = { provider: 'GitHub', uid: '0-github', user: 'usr1', actions: { maxRunsPerWorkflow: 3 } };
        let actual = gitHubAdapter.actions2model(provider, input, false);
        assert.equal(actual.items.length, 0);
    });

    it("actions2model handles null actor and missing display_title", function () {
        let input = { "org/repo": [
            { id: 1, workflow_id: 10, name: "CI", run_number: 1, display_title: "",
              status: "completed", conclusion: "success", event: "push",
              head_branch: "main", actor: null,
              html_url: "https://github.com/org/repo/actions/runs/1",
              run_started_at: "2026-01-01T00:00:00Z",
              created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:01:00Z" }
        ]};
        let provider = { provider: 'GitHub', uid: '0-github', user: 'usr1', actions: { maxRunsPerWorkflow: 3 } };
        let actual = gitHubAdapter.actions2model(provider, input, false);
        assert.equal(actual.items.length, 1);
        assert.equal(actual.items[0].author, "");
        assert.equal(actual.items[0].title, "CI"); // falls back to run.name when display_title is empty
    });

    it("actions2model preserves run_started_at in actions object", function () {
        let input = JSON.parse(fs.readFileSync('./input/github-actions-runs.json'));
        let provider = { provider: 'GitHub', uid: '0-github', user: 'usr1', actions: { maxRunsPerWorkflow: 3 } };
        let actual = gitHubAdapter.actions2model(provider, input, false);
        // First item (wf100, most recent non-PR) should have run_started_at
        let firstItem = actual.items[0];
        assert.equal(firstItem.actions.run_started_at, "2026-03-19T10:00:05Z");
        // In-progress run should also have run_started_at
        let inProgressItems = actual.items.filter(i => i.actions.status === "in_progress");
        assert.equal(inProgressItems.length, 1);
        assert.equal(inProgressItems[0].actions.run_started_at, "2026-03-19T12:00:05Z");
    });

    it("actions2model uses default maxRunsPerWorkflow when not configured", function () {
        let input = JSON.parse(fs.readFileSync('./input/github-actions-runs.json'));
        let provider = { provider: 'GitHub', uid: '0-github', user: 'usr1' }; // no actions config
        let actual = gitHubAdapter.actions2model(provider, input, false);
        // Default maxRunsPerWorkflow is 3, wf100 has 4 non-PR runs, should be sliced to 3
        let wf100Items = actual.items.filter(i => i.actions.workflow_id === 100);
        assert.equal(wf100Items.length, 3);
    });

    it("actions2model sorts runs by created_at descending within each workflow", function () {
        let input = JSON.parse(fs.readFileSync('./input/github-actions-runs.json'));
        let provider = { provider: 'GitHub', uid: '0-github', user: 'usr1', actions: { maxRunsPerWorkflow: 10 } };
        let actual = gitHubAdapter.actions2model(provider, input, false);
        let wf100Items = actual.items.filter(i => i.actions.workflow_id === 100);
        // Should be in descending created_at order: 10:00, 09:00, 08:00, 07:00
        for (let i = 1; i < wf100Items.length; i++) {
            assert.ok(new Date(wf100Items[i-1].created_at) >= new Date(wf100Items[i].created_at),
                "Items should be sorted by created_at descending");
        }
    });
});
