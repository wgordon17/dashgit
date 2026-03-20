import { cache } from "./Cache.js"
import { config } from "./Config.js"

/**
 * Primitive methods and constants to support generation of the html content from the work item view
 */
const wiRender = {
  gitHubIcon: '<i class="fa-brands fa-github"></i>',
  gitLabIcon: '<i class="fa-brands fa-square-gitlab"></i>',
  gitColor: '#F34F29',

  prIconClass: 'fa-solid fa-code-pull-request',
  issueIconClass: 'fa-regular fa-circle-dot',
  branchIconClass: 'fa-solid fa-code-branch',

  prIcon: '<i class="fa-solid fa-code-pull-request"></i>',
  forkIcon: '<i class="fa-solid fa-code-fork"></i>',

  successIcon: '<i class="wi-status-icon fa-solid fa-check" style="color:MediumSeaGreen" title="The build completed successfully"></i>',
  failureIcon: '<i class="wi-status-icon fa-solid fa-x" style="color:Red" title="The build ended with a failure"></i>',
  pendingIcon: '<i class="wi-status-icon fa-regular fa-circle" style="color:Orange" title="The build is running or waiting to run"></i>',
  unknownIcon: '<i class="wi-status-icon fa-regular fa-circle-question" style="color:#AAAAAA" title="The build status cannot be determined"></i>',
  spinnerIcon: `<span class="spinner-border spinner-border-sm text-secondary" style="opacity:15%" title="The build status is being determined"></span>`,
  spinnerClass: `spinner-border`,

  notificationIconClass: `fa-regular fa-bell`,
  mentionIconClass: `fa-solid fa-at`,

  //Primitive functions related to the display of single elements

  provider2html: function (provider) {
    if (provider.toLowerCase() == "github")
      return this.gitHubIcon;
    else if (provider.toLowerCase() == "gitlab")
      return this.gitLabIcon;
    else
      return '';
  },
  repourl2html: function (url, title) {
    return `<span><a href="${url}" target='_blank' class='fw-bold link-secondary link-underline-opacity-0 link-underline-opacity-100-hover'>${title}</a></span>`;
  },

  status2class: function (type, provider, uid) {
    //used to toggle visibility, issues are handled like a different status
    if (type == undefined)
      return "notavailable";
    if (type == "issue") //issues do not have status
      return "issue";
    let status = cache.getStatus(provider, uid);
    return status;
  },
  status2html: function (type, provider, uid, id) {
    if (type == "issue") //issues do not have status
      return "";
    // wraps the content (status icon) to later change the icon by id
    let status = cache.getStatus(provider, uid);
    return `<span id="wi-status-${id}">${wiRender.statusIcon(status)}</span>`;
  },
  type2html: function (type, highlight) {
  let titleSuffix = highlight ? " (new since your last visit to this view)" : "";
    if (type == "issue")
      return `<i class="${this.issueIconClass}" style="color:${highlight ? this.gitColor : "MediumSeaGreen"}" title="Issue${titleSuffix}"></i>`;
    else if (type == "pr")
      return `<i class="${this.prIconClass}" style="color:${highlight ? this.gitColor : "MediumSeaGreen"}" title="Pull Request${titleSuffix}"></i>`;
    else if (type == "branch")
      return `<i class="${this.branchIconClass}" style="color:${highlight ? this.gitColor : "DodgerBlue"}" title="Branch${titleSuffix}"></i>`;
    else
      return '';
  },
  notifications2html: function (provider, uid) {
    if (cache.notifCache[provider] == undefined)
      return "";
    let reason = cache.notifCache[provider][uid];
    if (reason == undefined)
      return "";
    let iconClass = reason == "mention" || reason == "mentioned" || reason == "directly_addressed" ? this.mentionIconClass : this.notificationIconClass;
    return `<i class="wi-notification-icon ${iconClass}" title="Unread notification, reason: ${reason}"></i>`;
  },

  updateCheck2html: function (target, providerId, repoName, iid) {
    if (config.data.enableManagerRepo && target == "dependabot") {
      // console.log(`${providerId} ${repoName} ${iid}`)
      return `<input class="form-check-input wi-update-check" type="checkbox" value="" aria-label="..."
          provider="${providerId}" repo="${repoName}" iid="${iid}"></input>&nbsp;`;
    }
    return "";
  },
  actions2html: function (actions) {
    if (actions == undefined)
      return "";
    let html = "";
    if (actions["review_request"])
  html += `<span class="wi-item-column-clickable badge text-dark bg-info wi-action-badge" title="A review has been requested for this PR"><i class="fa-solid fa-magnifying-glass"></i> review request</span> `;
    if (actions["changes_requested"])
  html += `<span class="wi-item-column-clickable badge text-light bg-primary wi-action-badge" title="A reviewer has commented and requested changes on this PR"><i class="fa-regular fa-comment"></i> changes requested</span> `;
    if (actions["follow_up"]) {
      let message = actions["follow_up_message"];
      message = $("<p>").text(message).html(); //sanitized
  html += `<span class="wi-item-column-clickable badge text-dark bg-warning wi-action-badge" title="This work item has been flagged for follow-up"><i class="fa-regular fa-flag"></i> ${message}</span> `;
    }
    return html;
  },
  branch2html: function (url, name) {
    if (name !== undefined)
      return `<span class="badge badge-light fw-bold" style="color:black; background-color:#DDF4FF;"><a class="link-underline-light" target="_blank" href="${url}">${name}</a></span>`;
    return "";
  },
  url2html: function (url, title) {
    return `<a href="${url}" target='_blank' class='link-dark link-underline-opacity-0 link-underline-opacity-100-hover'>${title}</a>`;
  },
  labels2html: function (repoName, labels) {
    let html = "";
    for (let label of labels)
      html += " " + this.gitlabel2html(repoName, label.name, label.color);
    return html;
  },

  statusIcon: function (status) {
    if (status == "success")
      return `${this.successIcon}`;
    else if (status == "failure")
      return `${this.failureIcon}`;
    else if (status == "pending")
      return `${this.pendingIcon}`;
    //There are three cases when the status is not known:
    // 1. Status has been determined as "notavailable", e.g. because there is no checks (GitHub) or pipelines (GitLab)
    // 2. Status has not been determined yet, e.g. at the beginnig, before calling the GraphQL api that determines the statuses
    // 3. Status can't be determined, e.g. the GraphQL api does not have access to the repo because of the query limits
    // Case 1 will display the unknown icon. Cases 2, 3 will display the spinner icon that will be replaced by unknown
    // just after the finish of the GraphQL call that determines the statuses
    else if (status == "notavailable")
      return `${this.unknownIcon}`;
    else
      return `${this.spinnerIcon}`;
  },

  headerbadge2html: function (color, count, message) {
    if (count == undefined || count == 0)
      return "";
    return ` <span class="badge badge-primary" style="background-color:${color}">${count} ${message}</span>`;
  },

  statusBadgeColor: function (status) {
    if (status == "success")
      return `bg-success`;
    else if (status == "failure")
      return `bg-danger`;
    else if (status == "pending")
      return `bg-warning`;
    else
      return `bg-secondary`;
  },
  statusBadgeStyle: function (status) {
    if (status == "success")
      return `background-color:MediumSeaGreen!important`;
    else
      return `opacity:0.9`;
  },

  gitlabel2html: function (repoName, name, color) {
    let cssClass = "badge rounded-pill";
    if (color == "") {
      color = "888888"; //default if no color found
      cssClass += " badge-color-undefined"; //to be replaced later (only GitLab)
    }
    //a custom attribute colorkey is set to allow locate labels in data from cache
    return `<span class="${cssClass}" style="${this.getLabelStyle(name, color)}" data-colorkey="${repoName}-${name}">${name}</span>`;
  },
  getLabelStyle: function (name, color) {
    let foreground = this.getColorLuma(color) > 140.0 ? "000000" : "ffffff";
    return `background-color:#${color}; color:#${foreground};`;
  },
  getColorLuma: function (color) {
    //https://stackoverflow.com/questions/12043187/how-to-check-if-hex-color-is-too-black
    //The resulting luma value range is 0..255, where 0 is the darkest and 255 is the lightest. 
    //Values greater than 128 are considered light by tinycolor
    let c = color.substring(1);      // strip #
    let rgb = parseInt(c, 16);   // convert rrggbb to decimal
    let r = (rgb >> 16) & 0xff;  // extract red
    let g = (rgb >> 8) & 0xff;  // extract green
    let b = (rgb >> 0) & 0xff;  // extract blue
    return 0.2126 * r + 0.7152 * g + 0.0722 * b; // per ITU-R BT.709
  },

  escHtml: function (str) {
    return $("<span>").text(str).html();
  },

  actionStatusClass: function (status, conclusion) {
    if (status === "completed") {
      if (conclusion === "success") return "success";
      if (conclusion === "failure" || conclusion === "timed_out") return "failure";
      return "notavailable";
    }
    if (status === "in_progress" || status === "queued" || status === "waiting" || status === "pending") return "pending";
    return "notavailable";
  },

  actionStatusBadge: function (status, conclusion) {
    if (status === "completed") {
      if (conclusion === "success") return '<span class="badge bg-success">success</span>';
      if (conclusion === "failure") return '<span class="badge bg-danger">failure</span>';
      if (conclusion === "cancelled") return '<span class="badge bg-secondary">cancelled</span>';
      if (conclusion === "skipped") return '<span class="badge bg-secondary">skipped</span>';
      if (conclusion === "timed_out") return '<span class="badge bg-danger">timed out</span>';
      return '<span class="badge bg-secondary">' + this.escHtml(conclusion || "unknown") + '</span>';
    }
    if (status === "in_progress") return '<span class="badge bg-warning text-dark"><span class="spinner-border spinner-border-sm" style="width:0.7em;height:0.7em"></span> running</span>';
    if (status === "queued" || status === "waiting" || status === "pending") return '<span class="badge bg-warning text-dark">queued</span>';
    return '<span class="badge bg-secondary">' + this.escHtml(status || "unknown") + '</span>';
  },

  formatDuration: function (startedAt, updatedAt, status) {
    if (!startedAt) return "queued";
    let start = new Date(startedAt);
    let end = status !== "completed" ? new Date() : new Date(updatedAt);
    let seconds = Math.floor((end - start) / 1000);
    if (seconds < 60) return seconds + "s";
    if (seconds < 3600) return Math.floor(seconds / 60) + "m " + (seconds % 60) + "s";
    return Math.floor(seconds / 3600) + "h " + Math.floor((seconds % 3600) / 60) + "m";
  },

  actionWorkflowHeader2html: function (workflowName, runCount, workflowId, repoName) {
    return '<tr class="wi-action-workflow-header" data-workflow="' + workflowId + '" data-repo="' + this.escHtml(repoName) + '" style="cursor:pointer">'
      + '<td colspan="4" style="padding-left:20px">'
      + '<i class="fa-solid fa-gear" style="color:DodgerBlue"></i> '
      + '<strong>' + this.escHtml(workflowName) + '</strong> '
      + '<span class="text-secondary">(' + runCount + ')</span> '
      + '<i class="fa-solid fa-chevron-down" style="font-size:0.7em;color:#888"></i>'
      + '</td></tr>';
  },

  actionRun2html: function (item) {
    let actions = item.actions || {};
    let statusClass = this.actionStatusClass(actions.status, actions.conclusion);
    let badge = this.actionStatusBadge(actions.status, actions.conclusion);
    let duration = this.formatDuration(actions.run_started_at, item.updated_at, actions.status);
    let eventBadge = actions.event ? '<span class="badge bg-light text-dark border">' + this.escHtml(actions.event) + '</span>' : '';
    let branchBadge = actions.head_branch ? '<span class="badge badge-light fw-bold" style="color:black; background-color:#DDF4FF;">' + this.escHtml(actions.head_branch) + '</span>' : '';
    return '<tr class="wi-status-class-any wi-status-class-' + statusClass + '" itemrepo="' + this.escHtml(item.repo_name) + '" data-workflow="' + actions.workflow_id + '" data-repo="' + this.escHtml(item.repo_name) + '" style="padding-left:40px">'
      + '<td style="width:24px;">' + badge + '</td>'
      + '<td>'
      + branchBadge + ' '
      + '<a href="' + this.escHtml(item.url) + '" target="_blank" class="link-dark link-underline-opacity-0 link-underline-opacity-100-hover">' + this.escHtml(item.title) + '</a> '
      + '<span class="text-secondary">' + this.escHtml(item.iidstr) + '</span> '
      + eventBadge + ' '
      + '<span class="text-secondary">' + this.escHtml(duration) + '</span>'
      + '</td></tr>';
  },

  forkRow2html: function (item) {
    const esc = this.escHtml;
    const actions = item.actions ?? {};
    const repoName = esc(item.repo_name);
    const upstreamName = esc(item.title);
    const forkUrl = esc(item.url);
    const upstreamUrl = esc(item.repo_url);
    const workflowFile = esc(actions.workflow_file);
    const defaultBranch = esc(actions.default_branch || 'main');

    // Status badges: count badges for behind/ahead, named badges for terminal states
    let statusHtml = '';
    if (actions.sync_status === 'unknown') {
      statusHtml = `<span class="badge bg-secondary">unknown</span>`;
    } else if (actions.behind_by > 0 || actions.ahead_by > 0) {
      if (actions.behind_by > 0)
        statusHtml += `<span class="badge bg-warning text-dark">${actions.behind_by} behind</span> `;
      if (actions.ahead_by > 0)
        statusHtml += `<span class="badge bg-info text-dark">${actions.ahead_by} ahead</span> `;
    } else {
      statusHtml = `<span class="badge bg-success">up to date</span> `;
    }
    if (actions.sync_pr_number)
      statusHtml += `<a href="${esc(actions.sync_pr_url)}" target="_blank" class="badge bg-primary text-decoration-none">PR #${parseInt(actions.sync_pr_number)}</a>`;

    const syncButton = actions.behind_by > 0 && actions.sync_status !== 'pr-open'
      ? ` <button class="btn btn-warning btn-sm wi-fork-sync-btn" data-fork="${repoName}" data-workflow="${workflowFile}" data-ref="${defaultBranch}">
          <i class="fa-solid fa-arrows-rotate"></i> Sync</button>`
      : '';

    return `
    <tr class="wi-status-class-any" itemrepo="${repoName}">
      <td style="width:24px;"><i class="fa-solid fa-code-fork" style="color:DodgerBlue"></i></td>
      <td>
        <span class="fw-bold"><a href="${forkUrl}" target="_blank" class="link-dark link-underline-opacity-0 link-underline-opacity-100-hover">${repoName}</a></span>
        <span class="text-secondary"> &larr; </span>
        <span><a href="${upstreamUrl}" target="_blank" class="link-secondary link-underline-opacity-0 link-underline-opacity-100-hover">${upstreamName}</a></span>
      </td>
      <td>${statusHtml}</td>
      <td>${syncButton}</td>
    </tr>
    `;
  },

}

export { wiRender };
