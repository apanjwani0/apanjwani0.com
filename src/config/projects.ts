export interface Project {
  title: string
  url: string
  description: string
  tags: string[]
}

export const projects: Project[] = [
  {
    title: 'Scrape-Instagram',
    url: 'https://github.com/apanjwani0/Scrape-Instagram',
    description: 'Scalable web-scraping pipeline for automated Instagram data extraction and ZIP bundling of media assets.',
    tags: ['open-source', 'nodejs', 'puppeteer', 'javascript'],
  },
  {
    title: 'Shopify HTML Emailer',
    url: 'https://github.com/apanjwani0/Shopify-HTML-Emailer',
    description: 'Shopify app with a visual HTML email editor and sender, built with Next.js, Koa, and Polaris.',
    tags: ['shopify', 'nextjs', 'nodejs', 'react'],
  },
  {
    title: 'Node.js Benchmarking',
    url: 'https://github.com/apanjwani0/Node.js-Benchmarking',
    description: 'Benchmark comparing server-side calculation performance against MongoDB aggregate queries in Node.js.',
    tags: ['nodejs', 'mongodb', 'performance', 'javascript'],
  },
  {
    title: 'Chat App',
    url: 'https://github.com/apanjwani0/Chat-App',
    description: 'Real-time chat application built with Node.js and Socket.io.',
    tags: ['nodejs', 'socket.io', 'javascript'],
  },
]
