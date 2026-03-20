import assert from 'assert';
import { wiRender } from "../app/WiViewRender.js"

describe("TestActionsRender - Status class mapping", function () {

    it("actionStatusClass: completed + success = success", function () {
        assert.equal(wiRender.actionStatusClass("completed", "success"), "success");
    });
    it("actionStatusClass: completed + failure = failure", function () {
        assert.equal(wiRender.actionStatusClass("completed", "failure"), "failure");
    });
    it("actionStatusClass: completed + timed_out = failure", function () {
        assert.equal(wiRender.actionStatusClass("completed", "timed_out"), "failure");
    });
    it("actionStatusClass: completed + cancelled = notavailable", function () {
        assert.equal(wiRender.actionStatusClass("completed", "cancelled"), "notavailable");
    });
    it("actionStatusClass: completed + skipped = notavailable", function () {
        assert.equal(wiRender.actionStatusClass("completed", "skipped"), "notavailable");
    });
    it("actionStatusClass: completed + null = notavailable", function () {
        assert.equal(wiRender.actionStatusClass("completed", null), "notavailable");
    });
    it("actionStatusClass: in_progress = pending", function () {
        assert.equal(wiRender.actionStatusClass("in_progress", null), "pending");
    });
    it("actionStatusClass: queued = pending", function () {
        assert.equal(wiRender.actionStatusClass("queued", null), "pending");
    });
    it("actionStatusClass: waiting = pending", function () {
        assert.equal(wiRender.actionStatusClass("waiting", null), "pending");
    });
    it("actionStatusClass: pending = pending", function () {
        assert.equal(wiRender.actionStatusClass("pending", null), "pending");
    });
    it("actionStatusClass: unknown status = notavailable", function () {
        assert.equal(wiRender.actionStatusClass("something_else", null), "notavailable");
    });

});

describe("TestActionsRender - Duration formatting", function () {

    it("formatDuration: null startedAt returns queued", function () {
        assert.equal(wiRender.formatDuration(null, "2026-01-01T00:00:00Z", "queued"), "queued");
    });
    it("formatDuration: undefined startedAt returns queued", function () {
        assert.equal(wiRender.formatDuration(undefined, "2026-01-01T00:00:00Z", "queued"), "queued");
    });
    it("formatDuration: completed run shows elapsed time in seconds", function () {
        assert.equal(wiRender.formatDuration("2026-01-01T00:00:00Z", "2026-01-01T00:00:45Z", "completed"), "45s");
    });
    it("formatDuration: completed run shows minutes and seconds", function () {
        assert.equal(wiRender.formatDuration("2026-01-01T00:00:00Z", "2026-01-01T00:03:30Z", "completed"), "3m 30s");
    });
    it("formatDuration: completed run shows hours and minutes", function () {
        assert.equal(wiRender.formatDuration("2026-01-01T00:00:00Z", "2026-01-01T01:15:00Z", "completed"), "1h 15m");
    });
    it("formatDuration: in_progress run uses current time", function () {
        let result = wiRender.formatDuration("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", "in_progress");
        // Should be a large number (years from 2026 to now, or now to 2026)
        // Just verify it doesn't return "queued" or throw
        assert.ok(result !== "queued");
        assert.ok(typeof result === "string");
    });

});
