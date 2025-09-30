// Notify PR Review (team-channel + shared mapping, Levi tone)
// Forked customization
// Apache-2.0

const core = require('@actions/core');
const github = require('@actions/github');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

/** ===== 팀별 커스텀: 채널명/매핑 파일 경로만 수정 ===== */
const CHANNEL = 'C09HMH5CHS4';           // 팀 채널 고정 (또는 채널 ID 'Cxxxx')
const MAP_PATH = '.github/slack-map.json';      // 서비스 리포 내 공유 JSON
/** =============================================== */

const ENCODE_PAIR = { '<': '&lt;', '>': '&gt;' };
const encodeText = (text) => text.replace(/[<>]/g, (m) => ENCODE_PAIR[m]);

const gh = axios.create({
  baseURL: 'https://api.github.com',
  headers: { Authorization: `token ${core.getInput('token')}` }
});

const slack = axios.create({
  baseURL: 'https://slack.com/api',
  headers: {
    Authorization: `Bearer ${core.getInput('slackBotToken')}`,
    'Content-Type': 'application/json'
  }
});

function loadSlackMap() {
  try {
    const full = path.resolve(process.cwd(), MAP_PATH);
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (e) {
    core.warning(`Slack map not found or invalid at ${MAP_PATH}: ${e.message}`);
    return {};
  }
}

async function fetchUser(url) {
  const { data } = await gh.get(url);
  return data;
}

function buildBlocks({ repoName, labels, title, url, mention }) {
  const D0 = 'D-0';
  const d0exists = (labels || []).some((l) => l.name === D0);

  // 헤더 멘트 (랜덤)
  const headerVariants = [
    `📢 ${mention} 리뷰 요청이다. 지체하지 말고 바로 확인해라.`,
    `📢 ${mention} 시간 끌면 일정이 무너진다. 지금 당장 리뷰해라.`,
    `📢 ${mention} 조사병단답게 움직여라. 심장을 바쳐라.`,
    `📢 ${mention} 게을러지지 마라. 확인하고 대응해라.`,
    `📢 ${mention} 리뷰가 밀려 있다. 먼저 처리해라.`
  ];
  const headerText = headerVariants[Math.floor(Math.random() * headerVariants.length)];

  // 하단 컨텍스트 멘트 (랜덤)
  const contextVariants = [
    '⚠️ 리뷰를 미루면 머지와 릴리스가 늦어진다. 변명 금지, 즉시 피드백해라.',
    '⚠️ 일정은 기다려주지 않는다. 끝낼 수 있을 때 끝내라.',
    '⚠️ 결론을 미루지 마라. 승인하든, 수정을 요구하든 지금 결정해라.',
    '⚠️ 조사병단, 임무에 집중해라. 심장을 바쳐라.'
  ];
  const contextText = contextVariants[Math.floor(Math.random() * contextVariants.length)];

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: headerText
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${repoName}:*\n<${url}|${encodeText(title)}>`
      }
    }
  ];

  if ((labels || []).length) {
    blocks.push({
      type: 'actions',
      elements: labels.map(({ name }) => ({
        type: 'button',
        text: { type: 'plain_text', text: name },
        ...(name === D0 ? { style: 'danger' } : {})
      }))
    });
  }

  // D-0 긴급 멘트가 필요하면 아래 주석 해제
  if (d0exists) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*⚠️ \`${D0}\` 긴급 PR이다. 지금 처리해라.*`
      }
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: contextText
      }
    ]
  });

  return blocks;
}

(async () => {
  try {
    const {
      context: {
        payload: {
          pull_request: { title, html_url: prUrl, labels, draft },
          sender,
          requested_reviewer: requestedReviewer,
          requested_team: requestedTeam,
          repository: { full_name: repoName }
        }
      }
    } = github;

    // 옵션: Draft PR 스킵
    const skipDraft = core.getInput('skipDraft') === 'true';
    if (skipDraft && draft) {
      core.notice(`Skipping draft PR: ${title} (${prUrl})`);
      return;
    }

    // 팀 리뷰 케이스: 개인 리뷰어가 없으면 팀명만 표기(간단 안내)
    if (!requestedReviewer) {
      const teamName = requestedTeam?.name || 'unknown-team';
      const mention = `*${teamName}*`;
      const res = await slack.post('/chat.postMessage', {
        channel: CHANNEL,
        text: '리뷰 요청이다. 바로 확인해라.',
        blocks: buildBlocks({ repoName, labels, title, url: prUrl, mention })
      });
      if (!res.data?.ok) {
        throw new Error(`Slack error: ${res.data?.error || 'unknown_error'} (channel=${CHANNEL})`);
      }
      core.notice(`Sent team review notice for ${teamName}`);
      return;
    }

    // 개인 리뷰 케이스
    const map = loadSlackMap();
    const { login, url } = requestedReviewer;

    core.notice(`Sender: ${sender.login}, Receiver: ${login}, PR: ${prUrl}`);

    let mention = null;
     
    // 1) 매핑 우선 (정확 멘션)
    if (map[login]) {
      mention = `<@${map[login]}>`;
      core.info(`Mapped '${login}' -> ${mention}`);
    } else {
      // 2) Fallback: GitHub 로그인으로 멘션 시도
      mention = `<@${login}>`;
      core.warning(`No mapping for '${login}'. Fallback to '<@${login}>'`);
    }

    const res = await slack.post('/chat.postMessage', {
      channel: CHANNEL,
      text: '리뷰 요청이다. 지체 없이 확인해라.',
      blocks: buildBlocks({ repoName, labels, title, url: prUrl, mention })
    });
    if (!res.data?.ok) {
      throw new Error(`Slack error: ${res.data?.error || 'unknown_error'} (channel=${CHANNEL})`);
    }

    core.notice('Successfully sent');
  } catch (e) {
    core.setFailed(e.message);
  }
})();
