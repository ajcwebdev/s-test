// src/logs.ts

import { openai } from '@ai-sdk/openai'
import { generateText, tool } from 'ai'
import { z } from 'zod'
import fetch from 'node-fetch'

const { OPENAI_API_KEY, SEMAPHORE_TOKEN, SLACK_WEBHOOK_URL } = process.env

if (!OPENAI_API_KEY) {
  throw new Error('Missing OPENAI_API_KEY environment variable.')
}

// 1. Tool to read logs from a local file (as an example)
const readLocalLogs = tool({
  description: 'Read logs from a local file on disk',
  parameters: z.object({
    path: z.string(), // The path to the log file
  }),
  async execute({ path }) {
    const fs = await import('fs/promises')
    return fs.readFile(path, 'utf-8')
  },
})

// 2. Tool to fetch logs from Semaphore (example)
const fetchSemaphoreLogs = tool({
  description: 'Fetch logs from Semaphore for a specific job or pipeline',
  parameters: z.object({
    workflowId: z.string(),
    jobId: z.string(),
  }),
  async execute({ workflowId, jobId }) {
    if (!SEMAPHORE_TOKEN) {
      throw new Error('SEMAPHORE_TOKEN is not set in environment.')
    }
    // Example of how you might fetch logs from Semaphore's API
    const url = `https://api.semaphoreci.com/workflows/${workflowId}/jobs/${jobId}/logs`
    const res = await fetch(url, {
      headers: {
        Authorization: `Token ${SEMAPHORE_TOKEN}`,
      },
    })
    if (!res.ok) {
      throw new Error(`Failed to fetch logs: ${res.statusText}`)
    }
    return res.text()
  },
})

// 3. Optionally post results to Slack
async function postToSlack(message: string) {
  if (!SLACK_WEBHOOK_URL) {
    console.warn('SLACK_WEBHOOK_URL not provided; skipping Slack notification.')
    return
  }
  await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message }),
  })
  console.log('Posted debug summary to Slack.')
}

// 4. Main function that orchestrates log analysis
async function analyzeLogs() {
  try {
    const { text } = await generateText({
      model: openai('gpt-4o'),
      system: `
        You are an AI assistant specialized in diagnosing CI/CD and application log errors.
        - Identify recurring failures or error patterns.
        - Suggest potential fixes or pipeline optimizations.
        - Provide a concise summary for immediate insight.
      `,
      prompt: `
        We want to analyze recent logs for errors or inefficiencies.
        You can call "readLocalLogs" or "fetchSemaphoreLogs" if you need data.
        Provide a summary of issues and recommended optimizations.
      `,
      // Provide the tools so the AI can fetch the logs
      tools: {
        readLocalLogs,
        fetchSemaphoreLogs,
      },
      maxSteps: 3, // AI can call up to three roundtrips
    })

    console.log('=== Log Analysis Summary ===')
    console.log(text)
    console.log('================================')

    // (Optional) Send the summary to Slack
    await postToSlack(text)
  } catch (error) {
    console.error('Error analyzing logs:', error)
  }
}

analyzeLogs()