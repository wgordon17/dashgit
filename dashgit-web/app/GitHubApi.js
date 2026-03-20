import { Octokit } from "octokit/rest"
import { graphql } from "octokit/graphql"
import { gitHubAdapter } from "./GitHubAdapter.js"
import { gitStoreApi } from "./GitStoreApi.js"
import { wiController } from "./WiController.js"
import { config } from "./Config.js"

/**
 * Core interface with the provider api (GitHub).
 * Al services and return a provider-independent model (using an adapter) to show in the UI.
 * See doc at Controller.js
 */
const gitHubApi = {

  log: function (providerId, message, model) {
    console.log(`${providerId}: ${message}`);
    if (model != undefined)
      console.log(model);
  },

  userAgent: config.getGitHubUserAgent(),

  getWorkItems: async function (target, provider, sorting) {
    const token = config.decrypt(provider.token);
    const octokit = new Octokit({ userAgent: this.userAgent, auth: token });
    // issue #116 set sorting criteria to match the selected in the UI
    const sort = (sorting??"").includes("updated") ? "updated" : "created";
    const order = (sorting??"").includes("descending") ? "desc" : "asc";
    const options = { sort:sort, order:order, advanced_search:true };
    // issue #184, add advanced_search, check if can be removed after September 2025
    const assigned = { q:`is:open assignee:${provider.user} archived:false`, ...options };
    const unassigned = { q:`is:open no:assignee owner:placeholder archived:false`, per_page: 100, ...options };
    const reviewer = { q:`is:open is:pr user-review-requested:${provider.user} archived:false`, ...options };
    const revise= { q:`is:open is:pr review:changes_requested author:${provider.user} archived:false`, ...options };
    const created = { q:`is:open author:${provider.user} archived:false`, ...options };
    const involved = { q:`is:open involves:${provider.user} archived:false`, ...options };
    const dependabot = { q:`is:open is:pr author:app/dependabot owner:placeholder archived:false`, per_page: 100, ...options };
    const dependabotTest = { q:`is:open is:pr author:${provider.user} archived:false in:title "Test pull Request for dependabot/testupdate"`, per_page: 100, ...options };
    let promises = [];
    if (target == "assigned")
      promises = [
        // spread because this returns an array with one or two queries depending on the kind of token used
        ...this.issuesAndPullRequests(octokit, token, assigned),
        //To allow the ui to mark this as a review request, the api call is wrapped to add a special attribute (called custom_actions) to the response
        this.wrapIssuesAndPullRequestsCall(octokit, reviewer, "review_request"),
        this.wrapIssuesAndPullRequestsCall(octokit, revise, "changes_requested"),
        //Also show work items that need follow-up
        gitStoreApi.followUpAll(provider, true),
      ];
    else if (target == "unassigned") { // a call api for each owner (#184)
       const owners = [provider.user, ...provider.unassignedAdditionalOwner];
       promises = [
        ...this.multiOwnerIssuesAndPullRequests(octokit, unassigned, owners),
      ];}
    else if (target == "created")
      promises = [
        ...this.issuesAndPullRequests(octokit, token, created)
      ];
    else if (target == "involved")
      promises = [
        ...this.issuesAndPullRequests(octokit, token, involved)
      ];
    else if (target == "follow-up")
      promises = [
        gitStoreApi.followUpAll(provider, false)
      ];
    else if (target == "dependabot") { // a call api for each owner (#184)
      const owners = (provider.user + " " + provider.dependabotAdditionalOwner).trim().split(" ");
      promises = [
        ...this.multiOwnerIssuesAndPullRequests(octokit, dependabot, owners),
      ];
      if (config.ff["updtest"])
        promises.push(this.octokitSearchIssues(octokit, dependabotTest));
    } else
      return;

    return await this.dispatchPromisesAndGetModel(target, provider, promises);
  },
  dispatchPromisesAndGetModel: async function(target, provider, promises) {
    const t0 = Date.now();
    const responses = await Promise.all(promises);
    this.log(provider.uid, `Data received from the api [${Date.now() - t0}ms]:`, responses);
    //creates single result with all responses
    let allResponses = [];
    for (let response of responses)
      if (response.followUp != undefined) // follow-ups have different structure than other items
        allResponses.push(...response.followUp);
      else
        allResponses.push(...response.data.items);
    let model = gitHubAdapter.workitems2model(provider, allResponses);
    model.header.target = target;
    return model;
  },
  issuesAndPullRequests: function (octokit, token, query) {
    // Issue #129 Although documentation says that search query returns both issues and prs if no 'is:*' is specified,
    // this is not true when using fine grained tokens, that requires separate queries for issues and prs.
    if (token == "" || token.startsWith("ghp_")) { // single query for no token or fine grained token
      return [this.octokitSearchIssues(octokit, query)];
    } else { // separated queries to find issues and prs
      console.log("Assuming fine grained token, using separated queries for issues and PRs");
      let qissue = JSON.parse(JSON.stringify(query));
      let qpr = JSON.parse(JSON.stringify(query));
      qissue.q = "is:issue " + query.q;
      qpr.q = "is:pr " + query.q;
      return [this.octokitSearchIssues(octokit, qissue), this.octokitSearchIssues(octokit, pr)];
    }
  },
  wrapIssuesAndPullRequestsCall: async function (octokit, query, action) {
    return this.octokitSearchIssues(octokit, query)
      .then(async function (response) {
        gitHubAdapter.addActionToPullRequestItems(response.data.items, action);
        return response;
      })
  },
  // returns an array of promises for a query, one for each of the items in owner
  multiOwnerIssuesAndPullRequests: function(octokit, query, owners) {
    const queries = owners.map(owner => ({ ...query, q: query.q.replace("owner:placeholder", `owner:${owner}`)}));
    const calls = queries.map(query => this.octokitSearchIssues(octokit, query));
    return calls;
  },
  
  // octokit rest search issuesAndPullRequests does not exist anymore (#184), this method makes the appropriate search call
  octokitSearchIssues: function(octokit, query) {
    return octokit.request('GET /search/issues', query);
  },

  // Tracks the poll interval as indicated by the api doc https://docs.github.com/en/rest/activity/notifications?apiVersion=2022-11-28
  // to call at most once during the poll interval. These variable are used by all GitHub providers
  notifLastModified: undefined,
  notifPollInterval: undefined,
  updateNotificationsAsync: function (target, provider) {
    if (provider.token == "") //skip if no token provider to avoid api call errors
      return;
    // Poll interval control, if inside the interval, do not call the api, but update notifications
    let currentTime = Math.floor(new Date().getTime()/1000);
    if (this.notifLastModified != undefined && currentTime - this.notifLastModified < this.notifPollInterval) {
      this.log(provider.uid, `ASYNC Get Notifications using cached notifications, seconds to next api call: ${currentTime - this.notifLastModified}, poll interval: ${this.notifPollInterval}`);
      wiController.updateNotifications(provider.uid, null); // don't pass model to use the cached notifications
      return;
    }
    this.log(provider.uid, "ASYNC Get Notifications from the REST api");
    const octokit = new Octokit({ userAgent: this.userAgent, auth: config.decrypt(provider.token), });
    // Issue #44: According the api doc a call using Last-Modified header should be done. 
    // This works well when a notification appears, But when the notification is read, the browser still gets not modified (when using cache).
    // Therefore, this approach can't be used and overrides the cache using If-None-Match header.
    gitHubApi.notifLastModified = Math.floor(new Date().getTime()/1000);
    gitHubApi.notifPollInterval = 120; //default value, if below query fails (eg. token without permission), next call will be done after this interval
    octokit.rest.activity.listNotificationsForAuthenticatedUser({ participating: true, headers: { 'If-None-Match': '' } }).then(function (response) {
      gitHubApi.log(provider.uid, "ASYNC Notifications response:", response);
      gitHubApi.notifPollInterval = response.headers["x-poll-interval"];
      let model = gitHubAdapter.notifications2model(response);
      wiController.updateNotifications(provider.uid, model); //direct call instead of using a callback
    });
  },

  getStatusesRequest: async function (provider, updateSince) {
    const graphqlV2 = !provider.graphql.deprecatedGraphqlV1;
    let userSpecRepos = graphqlV2 ? provider.graphql.userSpecRepos : "";
    if (provider.token == "") //returns empty model if no token provider to avoid api call errors
      return gitHubAdapter.statuses2model(provider, {}, graphqlV2);
    let gqlresponse = {};
    try {
      // check how many repositories must be updated, this info will be used to construct the query
      let updateReqs = await this.getStatusesUpdateRequirements(provider, userSpecRepos, updateSince, graphqlV2);
      if (updateReqs.maxProjects == 0 && updateReqs.otherRepos == "") {
        this.log(provider.uid, `No projects to update, since: "${updateSince}":`);
        return gitHubAdapter.statuses2model(provider, {}, graphqlV2);
      }
      gqlresponse = await this.graphQlWithPagination(provider, updateReqs.maxProjects, provider.graphql.pageSize, updateReqs.otherRepos, true, updateSince == "", graphqlV2);
      this.log(provider.uid, `Statuses graphql response, maxProjects: ${updateReqs.maxProjects} and "${updateReqs.otherRepos}", since: "${updateSince}":`, gqlresponse);
    } catch (error) {
      console.error("GitHub GraphQL api call failed");
      console.error(error);
      wiController.updateStatusesOnError("GitHub GraphQL api call failed. Message: " + error, provider.uid);
    }
    // Conversion to the model requires a previous postprocessing to get the user specified repositories (if any)
    gqlresponse = gitHubAdapter.postprocessGraphQl(gqlresponse);
    const model = gitHubAdapter.statuses2model(provider, gqlresponse, graphqlV2);
    return model;
  },

  //Gets number of repositories and other user specified that require update
  getStatusesUpdateRequirements: async function (provider, userSpecRepos, updateSince, graphqlV2) {
    let updateReqs = { maxProjects: provider.graphql.maxProjects, otherRepos: userSpecRepos };
    if (updateSince == "")
      return updateReqs;

    const t0 = Date.now();
    let gqlresponse0 = await this.graphQlWithPagination(provider, provider.graphql.maxProjects, provider.graphql.maxProjects, updateReqs.otherRepos, false, false, graphqlV2);
    gitHubApi.log(provider.uid, `Statuses graphql response, time to get update reqs [${Date.now() - t0}ms]:`, gqlresponse0);
    //console.log("Count projects to update query model:")
    //console.log(gqlresponse0)
    updateReqs.maxProjects = gitHubAdapter.getNumReposToUpdate(gqlresponse0, updateReqs.maxProjects, updateSince);
    updateReqs.otherRepos = gitHubAdapter.getUserReposToUpdate(gqlresponse0, updateSince);
    return updateReqs;
  },

  //Gets the statuses model, but asynchronously.
  //When the model is completed, calls controller to update the status value of the current target
  updateStatusesAsync: function (provider, updateSince) {
    this.log(provider.uid, "Get Statuses from the GraphQL api");
    const t0 = Date.now();
    this.getStatusesRequest(provider, updateSince).then(function (model) {
      gitHubApi.log(provider.uid, `ASYNC Statuses model [${Date.now() - t0}ms]:`, model);
      wiController.updateStatuses(provider.uid, model, updateSince); //direct call instead of using a callback
    }).catch(function (error) {
      console.error("GitHub GraphQL transformation failed");
      console.error(error)
      wiController.updateStatusesOnError("GitHub GraphQL transformation failed. Message: " + error, provider.uid);
    });
  },

  graphQlWithPagination: async function (provider, maxProjects, maxPageSize, userSpecRepos, includeAll, pagedUpdate, graphqlV2) {
    maxPageSize = Math.max(maxPageSize, 2); // ensure in a range
    maxPageSize = Math.min(maxPageSize, 50);
    let allData = {};
    let page = 0;
    let remainingProjects = maxProjects;
    let hasNextPage = true;
    let endCursor = null;
    while (hasNextPage && remainingProjects > 0) {
      const pageSize = Math.min(remainingProjects, maxPageSize);
      const effectiveUserSpecRepos = endCursor == null ? userSpecRepos : ""; // only included in the first page
      const goal = includeAll ? "Get statuses" : "Get update reqs"
      gitHubApi.log(provider.uid, `${goal}, page ${++page}, page size ${pageSize}, remaining ${remainingProjects} ...`);
      const query = gitHubApi.getStatusesQuery(provider, pageSize, effectiveUserSpecRepos, includeAll, endCursor, graphqlV2);
      const graphql = gitHubApi.getGraphQlApi(provider);
      const response = await graphql(query);

      if (allData.viewer == undefined) // first page
        allData = response;
      else
        allData.viewer.repositories.nodes.push(...response.viewer.repositories.nodes);

      // prepare for next page
      remainingProjects -= pageSize;
      hasNextPage = response.viewer.repositories.pageInfo.hasNextPage;
      endCursor = response.viewer.repositories.pageInfo.endCursor;

      // if required, update the statuses of the partial model (all pages until now) to the ui
      // When handling last page, the ui will be fully updated by the caller
      if (includeAll && pagedUpdate && remainingProjects > 0 && hasNextPage) {
        const gqlresponse = gitHubAdapter.postprocessGraphQl(allData);
        const model = gitHubAdapter.statuses2model(provider, gqlresponse, graphqlV2);
        wiController.updateStatusesForPage(provider.uid, model); //direct call instead of using a callback
      }
    }
    return allData;
  },

  getGraphQlApi: function (provider) {
    return graphql.defaults({
      headers: {
        authorization: `token ${config.decrypt(provider.token)}`,
      },
    });
  },

  getStatusesQuery: function (provider, maxProjects, userSpecRepos, includeAll, cursor, graphqlV2) {
    let affiliations = provider.graphql.ownerAffiliations.toString();
    let forks = "isFork:false, ";
    if (provider.graphql.includeForks)
      forks = "";
    else if (provider.graphql.onlyForks)
      forks = "isFork:true, ";
    return `{
      viewer {
        login, resourcePath, url, repositories(first: ${maxProjects}, ownerAffiliations: [${affiliations}], 
        after: ${cursor == null ? "null" : `"${cursor}"`},
        ${forks} isArchived:false, orderBy: {field: PUSHED_AT, direction: DESC}) {
          nodes {
            name, nameWithOwner, url, pushedAt
            ${includeAll ? this.getReposSubquery(provider, graphqlV2) : ""}
          }
          pageInfo {
            hasNextPage, endCursor
          }
        }
      }
      ${graphqlV2 ? this.getUserSpecReposSubquery(provider, userSpecRepos, includeAll) : ""}
    }`;
  },
  getReposSubquery: function (provider, graphqlV2) {
    return `
    ${graphqlV2 ? this.getPullRequestsNode(provider) : ``}
    ${this.getRefsNode(provider)}
    `;
  },
  getPullRequestsNode: function(provider) {
    return `
    pullRequests(first: ${provider.graphql.maxBranches}, states:[OPEN], orderBy: {field:UPDATED_AT, direction:DESC}) 
      { edges { node { title, number, url, state, createdAt, updatedAt,
        headRefName, baseRepository {nameWithOwner}, headRepository {nameWithOwner}, 
        statusCheckRollup { state } } } }`;
  },
  getRefsNode: function(provider, graphqlV2) {
    return `
    refs(refPrefix: "refs/heads/", first: ${provider.graphql.maxBranches}) {
      nodes {
        name
        target {
          ... on Commit {
            ${!graphqlV2 ? `
            associatedPullRequests(first: 1) {
              edges {  node { title, number, url, state, createdAt, updatedAt } }
            }
            ` : ``}
            history(first: 1) { 
              nodes { messageHeadline, committedDate, statusCheckRollup { state } } 
            }
          }
        }
      }
    }`;
  },
  getUserSpecReposSubquery: function(provider, reposStr, includeAll) {
    if (reposStr == undefined)
      return "";
    let repos = reposStr.split(" ");
    let query = "";
    let i = 0;
    for (let item of repos) {
      if (item == "")
        continue;
      const repoAlias = "xr" + i;
      const repoAll = item.split("/");
      const owner = repoAll[0];
      const repo = repoAll.length < 2 ? "" :repoAll[1];
      query += `
    ${repoAlias}:repository(owner:"${owner}", name:"${repo}") {
      name, nameWithOwner, url, pushedAt, updatedAt
      ${includeAll ? this.getPullRequestsNode(provider) : ""}
    }`;
      i++;
    }
    return query
  },

  // Fork tracking API methods

  getForksGraphQlQuery: function (syncBranch, pageSize, cursor) {
    // Sanitize syncBranch to prevent GraphQL injection from user config
    syncBranch = syncBranch.replace(/["\\\n\r{}()]/g, '');
    return `{
      viewer {
        organizations(first: 100) {
          nodes { login }
        }
        repositories(isFork: true, first: ${pageSize}, orderBy: {field: PUSHED_AT, direction: DESC},
            after: ${cursor == null ? "null" : `"${cursor}"`}) {
          nodes {
            nameWithOwner, url
            defaultBranchRef { name }
            parent {
              nameWithOwner, url
              owner { login }
              defaultBranchRef { name }
            }
            pullRequests(headRefName: "${syncBranch}", states: OPEN, first: 1) {
              nodes { number, url }
            }
          }
          pageInfo { hasNextPage, endCursor }
        }
      }
    }`;
  },

  getForksGraphQlData: async function (provider, syncBranch) {
    const gql = this.getGraphQlApi(provider);
    let allNodes = [];
    let orgs = [];
    let hasNextPage = true;
    let endCursor = null;
    let page = 0;
    while (hasNextPage) {
      const query = this.getForksGraphQlQuery(syncBranch, 50, endCursor);
      this.log(provider.uid, `Get forks GraphQL, page ${++page} ...`);
      const response = await gql(query);
      if (page === 1)
        orgs = response.viewer.organizations.nodes.map(o => o.login.toLowerCase());
      allNodes.push(...response.viewer.repositories.nodes);
      hasNextPage = response.viewer.repositories.pageInfo.hasNextPage;
      endCursor = response.viewer.repositories.pageInfo.endCursor;
    }
    return { orgs, forks: allNodes };
  },

  getForkCompareStatus: async function (octokit, forkFullName, upstreamFullName, branch) {
    const upstreamOwner = upstreamFullName.split('/')[0];
    const forkOwner = forkFullName.split('/')[0];
    const repo = forkFullName.split('/')[1];
    try {
      const response = await octokit.request('GET /repos/{owner}/{repo}/compare/{basehead}', {
        owner: forkOwner, repo: repo,
        basehead: `${upstreamOwner}:${branch}...${forkOwner}:${branch}`
      });
      return { status: response.data.status, behind_by: response.data.behind_by, ahead_by: response.data.ahead_by };
    } catch (error) {
      if (error.status === 404)
        return { status: 'unknown', behind_by: 0, ahead_by: 0 };
      throw error;
    }
  },

  triggerSyncWorkflow: async function (provider, forkFullName, workflowFile, ref) {
    const token = config.decrypt(provider.token);
    const octokit = new Octokit({ userAgent: this.userAgent, auth: token });
    const owner = forkFullName.split('/')[0];
    const repo = forkFullName.split('/')[1];
    await octokit.request('POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches', {
      owner: owner, repo: repo, workflow_id: workflowFile, ref: ref || 'main'
    });
  },

  getForksData: async function (provider) {
    const token = config.decrypt(provider.token);
    const octokit = new Octokit({ userAgent: this.userAgent, auth: token });
    const t0 = Date.now();

    const syncBranch = provider.forks?.syncBranch ?? "upstream-sync";
    const workflowFile = provider.forks?.syncWorkflowFile ?? "upstream-sync.yml";

    // Single GraphQL call: orgs + forks (with parent info) + sync PRs
    const { orgs, forks } = await this.getForksGraphQlData(provider, syncBranch);
    this.log(provider.uid, `Forks GraphQL: ${forks.length} forks, ${orgs.length} orgs [${Date.now() - t0}ms]`);

    // Filter forks: must have a parent, not in user's orgs, not in excludeRepos
    const orgLogins = new Set(orgs);
    const excludeRepos = (provider.forks?.excludeRepos ?? []).map(r => r.toLowerCase());

    let filteredForks = forks.filter(fork => {
      if (!fork.parent) return false;
      if (orgLogins.has(fork.parent.owner.login.toLowerCase())) return false;
      if (excludeRepos.includes(fork.nameWithOwner.toLowerCase())) return false;
      return true;
    });

    // REST compare calls only (N calls — unavoidable, no GraphQL equivalent)
    // TODO: add concurrency limit for users with many forks to avoid rate limiting
    const forksWithStatus = await Promise.all(filteredForks.map(async fork => {
      const upstreamFullName = fork.parent.nameWithOwner;
      const defaultBranch = fork.parent.defaultBranchRef?.name || 'main';
      const forkFullName = fork.nameWithOwner;

      const compare = await this.getForkCompareStatus(octokit, forkFullName, upstreamFullName, defaultBranch);
      const syncPRNodes = fork.pullRequests?.nodes ?? [];
      const syncPR = syncPRNodes.length > 0 ? { number: syncPRNodes[0].number, url: syncPRNodes[0].url } : null;
      const syncStatus = gitHubAdapter.determineSyncStatus(compare, syncPR);

      return {
        fork_name: forkFullName,
        upstream_name: upstreamFullName,
        default_branch: defaultBranch,
        behind_by: compare.behind_by,
        ahead_by: compare.ahead_by,
        sync_status: syncStatus,
        sync_pr_number: syncPR?.number ?? null,
        sync_pr_url: syncPR?.url ?? null,
        workflow_file: workflowFile,
        url: fork.url,
        upstream_url: fork.parent.url
      };
    }));

    this.log(provider.uid, `Forks enrichment complete [${Date.now() - t0}ms]:`, forksWithStatus);
    return forksWithStatus;
  },

  // Actions tracker API methods

  getReposForActions: async function(provider) {
    let token = config.decrypt(provider.token);
    let octokit = new Octokit({ userAgent: this.userAgent, auth: token });
    this.log(provider.uid, "Getting repos for actions data");
    let response = await octokit.request('GET /user/repos', {
      sort: 'pushed',
      per_page: 100,
      affiliation: 'owner,collaborator,organization_member'
    });
    // Filter out archived and forked repos (they rarely have Actions enabled)
    return response.data
      .filter(r => !r.archived && !r.fork)
      .map(r => ({ owner: r.owner.login, repo: r.name, full_name: r.full_name }));
  },

  getActionsData: async function(provider) {
    let repos = await this.getReposForActions(provider);
    let token = config.decrypt(provider.token);
    let octokit = new Octokit({ userAgent: this.userAgent, auth: token });
    let results = {};
    this.log(provider.uid, "Getting actions data for " + repos.length + " repos");
    await Promise.allSettled(repos.map(async (repo) => {
      try {
        let response = await octokit.request('GET /repos/{owner}/{repo}/actions/runs', {
          owner: repo.owner,
          repo: repo.repo,
          per_page: 100
        });
        results[repo.full_name] = response.data.workflow_runs;
      } catch (error) {
        this.log(provider.uid, "Skipping " + repo.full_name + ": " + error.message);
      }
    }));
    return results;
  },

}

export { gitHubApi };
