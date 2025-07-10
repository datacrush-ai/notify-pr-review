// Notify PR Review
// Copyright (c) 2023-present NAVER Corp.
// Apache-2.0

const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');

const ENCODE_PAIR = {
    "<": "&lt;",
    ">": "&gt;"
};
const encodeText = text => text.replace(/[<>]/g, matched => ENCODE_PAIR[matched]);
const fetchUser = url => axios({
    method: "get",
    headers: {
        Authorization: `token ${core.getInput("token")}`
    },
    url
}).then(res => res.data);
const D0 = "D-0";
const sendSlack = ({repoName, labels, title, url, email}) => {
    const [name] = email.split("@");
    const d0exists = labels.some(label => label.name === D0);

    return axios({
        method: "post",
        headers: {
            Authorization: `Bearer ${core.getInput("slackBotToken")}`,
            "Content-Type": "application/json"
        },
        url: "https://slack.com/api/chat.postMessage",
        data: {
            channel: `@${name}`,
            text: "리뷰 요청을 받았어요! 😊",
            blocks: [
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `📬 <@${name}> 님 새로운 리뷰 요청이 도착했어요! 가능한 빠르게 리뷰에 참여해 주세요:`
                    }
                },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*${repoName}:*\n<${url}|${encodeText(title)}>`
                    }
                },
                ...labels.length ? [{
                    type: "actions",
                    elements: labels.map(({name}) => ({
                        type: "button",
                        text: {
                            type: "plain_text",
                            text: name
                        },
                        ...name === D0 ? {style: "danger"} : {}
                    }))
                }] : [],
                ...d0exists ? [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*🚨 \`${D0}\` PR로 매우 긴급한 PR입니다! 지금 바로 리뷰에 참여해 주세요! 🚨*`
                    }
                }] : [],
                {
                    type: "divider"
                },
                {
                    type: "context",
                    elements: [
                        {
                            type: "mrkdwn",
                            text: "💪 코드 리뷰는 코드 품질을 향상시키고, 버그를 줄이며, 팀원 간의 지식 공유와 협업을 촉진하는 핵심 프로세스입니다.\n🙏 적극적인 참여와 의견을 부탁드립니다."
                        }
                    ]
                }
            ]
        }
    });
};
(async () => {
    try {
        const {
            context: {
                payload: {
                    pull_request: {
                        title,
                        html_url: prUrl,
                        labels,
                        draft
                    },
                    sender,
                    requested_reviewer: requestedReviewer,
                    requested_team: requestedTeam,
                    repository: {
                        full_name: repoName
                    }
                }
            }
        } = github;

        // Check if we should skip draft PRs
        const skipDraft = core.getInput('skipDraft') === 'true';
        
        if (skipDraft && draft) {
            core.info(`Skipping notification for draft PR: ${title} (${prUrl})`);
            core.notice(`Skipping notification for draft PR: ${title} (${prUrl})`);
            return;
        }

        if (!requestedReviewer) {
            core.notice(`Failed: 'requested_reviewer' does not exist. Looks like you've requested a team review which is not yet supported. The team name is '${requestedTeam.name}'.`);

            return;
        }

        const {login, url} = requestedReviewer;

        core.notice(`Sender: ${sender.login}, Receiver: ${login}, PR: ${prUrl}`);
        core.info(`'${sender.login}' requests a pr review for ${title}(${prUrl})`);
        core.info(`Fetching information about '${login}'...`);

        const {email} = await fetchUser(url);

        core.info(`Sending a slack msg to '${login}'...`);

        if (!email) {
            core.warning(`Failed: '${login}' has no public email.`);
            core.notice(`Failed: '${login}' has no public email.`);

            return;
        }

        await sendSlack({repoName, labels, title, url: prUrl, email});

        core.info("Successfully sent");
        core.notice("Successfully sent");
    } catch (error) {
        core.setFailed(error.message);
    }
})();
