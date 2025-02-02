// src/pr.ts

import { openai } from '@ai-sdk/openai'
import { generateText, tool } from 'ai'
import { z } from 'zod'

// Read environment variables for GitHub owner and repo
const { GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN } = process.env

if (!GITHUB_OWNER) {
  throw new Error('Environment variable GITHUB_OWNER is not set.')
}
if (!GITHUB_REPO) {
  throw new Error('Environment variable GITHUB_REPO is not set.')
}
if (!GITHUB_TOKEN) {
  throw new Error('Environment variable GITHUB_TOKEN is not set.')
}

// 1. Define a tool that fetches PR information from GitHub
const fetchPullRequestDiff = tool({
  description: 'A tool to retrieve the diff for a GitHub pull request.',
  parameters: z.object({
    owner: z.string(),
    repo: z.string(),
    pullNumber: z.number(),
  }),
  // The "execute" function does the actual retrieval of the PR data
  // from the GitHub API. We'll return the diff as plain text.
  execute: async ({ owner, repo, pullNumber }) => {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`,
      {
        headers: {
          Accept: 'application/vnd.github.v3.diff',
          Authorization: `Bearer ${GITHUB_TOKEN}`,
        },
      }
    )

    if (!response.ok) {
      throw new Error(
        `Failed to fetch PR diff for #${pullNumber}: ${response.status} - ${response.statusText}`
      )
    }

    // Return the raw diff text
    return await response.text()
  },
})

// 2. Agent logic using generateText with a tool call
async function runCodeReview(pullNumber: number) {
  try {
    const { text } = await generateText({
      model: openai('gpt-4o'),
      system: `You are an AI assistant that reviews code changes in a pull request.
      - Summarize key modifications.
      - Flag potential security issues or code smells.
      - Suggest best practices or improvements where relevant.
      - Be concise but thorough in your review.`,
      // Include instructions so the model knows how to call the tool
      prompt: `
      The pull request to analyze is #${pullNumber} in the ${GITHUB_OWNER}/${GITHUB_REPO} repository.
      If you need the diff, call the "fetchPullRequestDiff" tool with:
      {
        "owner": "${GITHUB_OWNER}",
        "repo": "${GITHUB_REPO}",
        "pullNumber": ${pullNumber}
      }.
      `,
      tools: {
        fetchPullRequestDiff,
      },
      maxSteps: 2, // allow a couple of tool roundtrips
    })

    console.log('=== AI Review Summary ===')
    console.log(text)
    console.log('=========================')
  } catch (error) {
    console.error('Error running code review agent:', error)
  }
}

// 3. Read the pull request number from CLI args, then run the agent
const arg = process.argv[2]
if (!arg) {
  console.error('Usage: npx tsx --env-file=.env src/pr.ts <pull-number>')
  process.exit(1)
}

const pullNumber = parseInt(arg, 10)
if (isNaN(pullNumber)) {
  console.error(`Invalid pull request number: ${arg}`)
  process.exit(1)
}

runCodeReview(pullNumber)