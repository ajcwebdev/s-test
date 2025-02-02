// src/commit.ts

/**
 * A Node.js script to review code changes on a commit-by-commit basis
 * using the Vercel AI SDK, OpenAI, and GitHub's commit diff endpoints.
 *
 * @packageDocumentation
 */

import { openai } from '@ai-sdk/openai'
import { generateText, tool } from 'ai'
import { z } from 'zod'

/**
 * Reads required environment variables for GitHub owner, repo, and auth token.
 * @throws Error if any variable is missing.
 */
const { GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN, SEMAPHORE_GIT_SHA, SEMAPHORE_GIT_COMMIT_RANGE } = process.env

if (!GITHUB_OWNER) {
  throw new Error('Environment variable GITHUB_OWNER is not set.')
}
if (!GITHUB_REPO) {
  throw new Error('Environment variable GITHUB_REPO is not set.')
}
if (!GITHUB_TOKEN) {
  throw new Error('Environment variable GITHUB_TOKEN is not set.')
}

/**
 * A tool to retrieve the diff for a GitHub commit.
 * @public
 */
const fetchCommitDiff = tool({
  description: 'A tool to retrieve the diff for a GitHub commit.',
  parameters: z.object({
    owner: z.string(),
    repo: z.string(),
    sha: z.string(),
  }),
  /**
   * Retrieves the raw diff for a given commit SHA.
   * @param params - owner, repo, and sha of the commit
   * @returns The raw diff as plain text
   */
  execute: async ({ owner, repo, sha }) => {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`,
      {
        headers: {
          Accept: 'application/vnd.github.v3.diff',
          Authorization: `Bearer ${GITHUB_TOKEN}`,
        },
      }
    )

    if (!response.ok) {
      throw new Error(
        `Failed to fetch commit diff for ${sha}: ${response.status} - ${response.statusText}`
      )
    }

    return await response.text()
  },
})

/**
 * Main function that reviews commits in the specified commit range or single commit SHA.
 * Fetches each commit in the range, then invokes AI to summarize, flag issues, and suggest improvements.
 *
 * @public
 * @async
 */
async function runCommitReview() {
  try {
    // Determine if we have a commit range (e.g. "abc123...def456") or single commit
    const commitRange = SEMAPHORE_GIT_COMMIT_RANGE
    let commitsToReview: string[] = []

    if (commitRange && commitRange.includes('...')) {
      // If we have something like "abc123...def456", use the GitHub Compare endpoint
      const [base, head] = commitRange.split('...')
      const compareResponse = await fetch(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/compare/${base}...${head}`,
        {
          headers: {
            Accept: 'application/vnd.github.v3+json',
            Authorization: `Bearer ${GITHUB_TOKEN}`,
          },
        }
      )

      if (!compareResponse.ok) {
        throw new Error(
          `Failed to compare commits: ${compareResponse.status} - ${compareResponse.statusText}`
        )
      }

      const compareData = await compareResponse.json()
      if (!compareData.commits) {
        throw new Error('No commits found in the specified commit range.')
      }

      commitsToReview = compareData.commits.map((c: { sha: string }) => c.sha)
      if (!commitsToReview.length) {
        throw new Error('No commits available in the comparison data.')
      }
    } else {
      // If we have a single commit in SEMAPHORE_GIT_COMMIT_RANGE, or fallback to SEMAPHORE_GIT_SHA
      const singleCommit = commitRange || SEMAPHORE_GIT_SHA
      if (!singleCommit) {
        throw new Error('No commit or commit range found in environment variables.')
      }
      commitsToReview = [singleCommit]
    }

    console.log('=== AI Commit-by-Commit Review ===')
    for (const sha of commitsToReview) {
      const { text } = await generateText({
        model: openai('gpt-4o'),
        system: `You are an AI assistant that reviews code changes in a commit.
        - Summarize key modifications.
        - Flag potential security issues or code smells.
        - Suggest best practices or improvements where relevant.
        - Be concise but thorough in your review.`,
        prompt: `
        The commit to analyze is ${sha} in the ${GITHUB_OWNER}/${GITHUB_REPO} repository.
        If you need the diff, call the "fetchCommitDiff" tool with:
        {
          "owner": "${GITHUB_OWNER}",
          "repo": "${GITHUB_REPO}",
          "sha": "${sha}"
        }.
        `,
        tools: {
          fetchCommitDiff,
        },
        maxSteps: 2,
      })

      console.log(`--- Review for commit ${sha} ---`)
      console.log(text)
      console.log('---------------------------------')
    }
    console.log('=================================')
  } catch (error) {
    console.error('Error running commit-by-commit review agent:', error)
  }
}

// Execute the commit review process
runCommitReview()