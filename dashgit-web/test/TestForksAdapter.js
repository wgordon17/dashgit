import assert from 'assert';
import fs from "fs"
import { gitHubAdapter } from "../app/GitHubAdapter.js"

beforeEach(function() {
    if (!fs.existsSync("actual")){
        fs.mkdirSync("actual");
    }});

/**
 * Test the forks adapter taking as input the fork API data from an external file.
 * Test inputs represent different fork sync statuses: behind, up-to-date, pr-open, unknown.
 */
describe("TestForksAdapter - Model transformations from fork API results", function () {

    // Fork data with 4 forks in different states:
    // - behind upstream (behind_by > 0, no sync PR)
    // - up to date (behind_by == 0)
    // - PR open (sync PR exists)
    // - unknown status (compare API returned 404)
    it("Transform fork API results with multiple statuses", function () {
        let input = JSON.parse(fs.readFileSync("./input/forks-result1.json"));
        let provider = { provider: "GitHub", uid: "0-github", user: "myuser", url: 'https://github.com', api: 'https://api.github.com' };
        let actual = gitHubAdapter.forks2model(provider, input);
        fs.writeFileSync("./actual/forks-model1.json", JSON.stringify(actual, null, 2));
        let expected = JSON.parse(fs.readFileSync("./expected/forks-model1.json"));
        assert.deepEqual(expected, actual);
    });

    // Empty fork list
    it("Transform empty fork API results", function () {
        let input = JSON.parse(fs.readFileSync("./input/forks-result-empty.json"));
        let provider = { provider: "GitHub", uid: "0-github", user: "myuser", url: 'https://github.com', api: 'https://api.github.com' };
        let actual = gitHubAdapter.forks2model(provider, input);
        fs.writeFileSync("./actual/forks-model-empty.json", JSON.stringify(actual, null, 2));
        let expected = JSON.parse(fs.readFileSync("./expected/forks-model-empty.json"));
        assert.deepEqual(expected, actual);
    });

    // Verify model item properties
    it("Fork model items have correct type and actions", function () {
        let input = JSON.parse(fs.readFileSync("./input/forks-result1.json"));
        let provider = { provider: "GitHub", uid: "0-github", user: "myuser", url: 'https://github.com', api: 'https://api.github.com' };
        let model = gitHubAdapter.forks2model(provider, input);

        assert.equal(4, model.items.length);

        // First fork: behind
        assert.equal("fork", model.items[0].type);
        assert.equal("myuser/dashgit", model.items[0].repo_name);
        assert.equal("javiertuya/dashgit", model.items[0].title);
        assert.equal(5, model.items[0].actions.behind_by);
        assert.equal(2, model.items[0].actions.ahead_by);
        assert.equal("diverged", model.items[0].actions.sync_status);
        assert.equal(null, model.items[0].actions.sync_pr_number);

        // Third fork: pr-open
        assert.equal("pr-open", model.items[2].actions.sync_status);
        assert.equal(42, model.items[2].actions.sync_pr_number);
        assert.equal("https://github.com/myuser/syncing-repo/pull/42", model.items[2].actions.sync_pr_url);

        // Fourth fork: unknown
        assert.equal("unknown", model.items[3].actions.sync_status);
    });

});

describe("TestForksApi - Sync status determination", function () {

    it("determineSyncStatus: up-to-date when not behind or ahead", function () {
        assert.equal("up-to-date", gitHubAdapter.determineSyncStatus({ status: "identical", behind_by: 0, ahead_by: 0 }, null));
    });
    it("determineSyncStatus: behind when only behind_by > 0", function () {
        assert.equal("behind", gitHubAdapter.determineSyncStatus({ status: "behind", behind_by: 5, ahead_by: 0 }, null));
    });
    it("determineSyncStatus: ahead when only ahead_by > 0", function () {
        assert.equal("ahead", gitHubAdapter.determineSyncStatus({ status: "ahead", behind_by: 0, ahead_by: 3 }, null));
    });
    it("determineSyncStatus: diverged when both behind and ahead", function () {
        assert.equal("diverged", gitHubAdapter.determineSyncStatus({ status: "diverged", behind_by: 5, ahead_by: 2 }, null));
    });
    it("determineSyncStatus: pr-open takes precedence over behind", function () {
        assert.equal("pr-open", gitHubAdapter.determineSyncStatus({ status: "behind", behind_by: 5, ahead_by: 0 }, { number: 42 }));
    });
    it("determineSyncStatus: pr-open takes precedence over diverged", function () {
        assert.equal("pr-open", gitHubAdapter.determineSyncStatus({ status: "diverged", behind_by: 5, ahead_by: 2 }, { number: 1 }));
    });
    it("determineSyncStatus: unknown when compare status is unknown", function () {
        assert.equal("unknown", gitHubAdapter.determineSyncStatus({ status: "unknown", behind_by: 0, ahead_by: 0 }, null));
    });
    it("determineSyncStatus: unknown takes precedence over pr-open", function () {
        assert.equal("unknown", gitHubAdapter.determineSyncStatus({ status: "unknown", behind_by: 0, ahead_by: 0 }, { number: 42 }));
    });
});
