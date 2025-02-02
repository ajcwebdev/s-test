// src/release.ts

import { openai } from '@ai-sdk/openai'
import { generateText, tool } from 'ai'
import { z } from 'zod'

// Environment variables
const { GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN, OPENAI_API_KEY } = process.env

if (!GITHUB_OWNER || !GITHUB_REPO || !GITHUB_TOKEN) {
  throw new Error('Missing required environment variables for GitHub access.')
}
if (!OPENAI_API_KEY) {
  throw new Error('Missing OPENAI_API_KEY environment variable.')
}

// 1. Tool for fetching recent commits from GitHub
const fetchCommits = tool({
  description: 'Retrieve a list of recent commits from a GitHub repo.',
  parameters: z.object({
    owner: z.string(),
    repo: z.string(),
    perPage: z.number().optional().default(10),
  }),
  execute: async ({ owner, repo, perPage }) => {
    const url = `https://api.github.com/repos/${owner}/${repo}/commits?per_page=${perPage}`
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch commits: ${response.status} - ${response.statusText}`)
    }

    const data = await response.json()
    // Each commit object includes a "commit.message". We'll map just the messages.
    return data.map((commit: any) => commit.commit.message)
  },
})

// 2. Main release notes generator function
async function generateReleaseNotes() {
  try {
    const { text } = await generateText({
      model: openai('gpt-4o'),
      system: `
        You are an AI assistant that organizes and creates release notes.
        - Read commit messages.
        - Categorize them (Features, Fixes, Docs, etc.).
        - Provide a concise, Markdown-friendly summary of changes.
        - Omit trivial or merge commits if irrelevant.
      `,
      prompt: `
        We need release notes for the latest commits in ${GITHUB_OWNER}/${GITHUB_REPO}.
        To get them, call the "fetchCommits" tool. Summarize the commit messages as release notes.
      `,
      tools: { fetchCommits },
      maxSteps: 2, // AI can call the tool at most twice
    })

    console.log('=== AI-Generated Release Notes ===')
    console.log(text)
    console.log('==================================')
  } catch (error) {
    console.error('Error generating release notes:', error)
  }
}

// 3. Kick off the process
generateReleaseNotes()